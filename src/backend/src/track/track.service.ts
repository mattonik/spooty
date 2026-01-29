import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrackEntity, TrackStatusEnum } from './track.entity';
import { PlaylistEntity } from '../playlist/playlist.entity';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { EnvironmentEnum } from '../environmentEnum';
import { UtilsService } from '../shared/utils.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { YoutubeService } from '../shared/youtube.service';

enum WsTrackOperation {
  New = 'trackNew',
  Update = 'trackUpdate',
  Delete = 'trackDelete',
}
const FORCED_ERROR_PREFIX = 'Forced failure by user';
const STOPPED_ERROR_PREFIX = 'Stopped by user';

const isUserStoppedError = (error?: string): boolean =>
  typeof error === 'string' &&
  (error.startsWith(FORCED_ERROR_PREFIX) ||
    error.startsWith(STOPPED_ERROR_PREFIX));

@WebSocketGateway()
@Injectable()
export class TrackService {
  @WebSocketServer() io: Server;
  private readonly logger = new Logger(TrackService.name);

  constructor(
    @InjectRepository(TrackEntity)
    private repository: Repository<TrackEntity>,
    @InjectQueue('track-download-processor') private trackDownloadQueue: Queue,
    @InjectQueue('track-search-processor') private trackSearchQueue: Queue,
    private readonly configService: ConfigService,
    private readonly utilsService: UtilsService,
    private readonly youtubeService: YoutubeService,
  ) {}

  getAll(
    where?: { [key: string]: any },
    relations: Record<string, boolean> = {},
  ): Promise<TrackEntity[]> {
    return this.repository.find({ where, relations });
  }

  getAllByPlaylist(id: number): Promise<TrackEntity[]> {
    return this.repository.find({ where: { playlist: { id } } });
  }

  get(id: number): Promise<TrackEntity | null> {
    return this.repository.findOne({ where: { id }, relations: ['playlist'] });
  }

  async remove(id: number): Promise<void> {
    await this.repository.delete(id);
    this.io.emit(WsTrackOperation.Delete, { id });
  }

  async create(track: TrackEntity, playlist?: PlaylistEntity): Promise<void> {
    const savedTrack = await this.repository.save({ ...track, playlist });
    await this.trackSearchQueue.add('', savedTrack, {
      jobId: `id-${savedTrack.id}`,
    });
    this.io.emit(WsTrackOperation.New, {
      track: savedTrack,
      playlistId: playlist.id,
    });
  }

  async update(id: number, track: TrackEntity): Promise<void> {
    await this.repository.update(id, track);
    this.io.emit(WsTrackOperation.Update, track);
  }

  async retry(id: number): Promise<void> {
    const track = await this.get(id);
    await this.trackSearchQueue.add('', track, { jobId: `id-${id}` });
    await this.update(id, { ...track, status: TrackStatusEnum.New });
  }

  async findOnYoutube(track: TrackEntity): Promise<void> {
    if (!(await this.get(track.id))) {
      return;
    }
    await this.update(track.id, {
      ...track,
      status: TrackStatusEnum.Searching,
    });
    let updatedTrack: TrackEntity;
    try {
      const youtubeUrl = await this.youtubeService.findOnYoutubeOne(
        track.artist,
        track.name,
      );
      updatedTrack = { ...track, youtubeUrl, status: TrackStatusEnum.Queued };
    } catch (err) {
      this.logger.error(err);
      updatedTrack = {
        ...track,
        error: String(err),
        status: TrackStatusEnum.Error,
      };
    }
    await this.trackDownloadQueue.add('', updatedTrack, {
      jobId: `id-${updatedTrack.id}`,
    });
    await this.update(track.id, updatedTrack);
  }

  async downloadFromYoutube(track: TrackEntity): Promise<void> {
    if (!(await this.get(track.id))) {
      return;
    }
    if (
      !track.name ||
      !track.artist ||
      !track.playlist
    ) {
      this.logger.error(
        `Track or playlist field is null or undefined: name=${track.name}, artist=${track.artist}, playlist=${track.playlist ? 'ok' : 'null'}`,
      );
      return;
    }
    // Use track's own coverUrl if available, otherwise fall back to playlist coverUrl
    const coverUrl = track.coverUrl || track.playlist.coverUrl;
    if (!coverUrl) {
      this.logger.warn(
        `No cover art available for track: ${track.artist} - ${track.name}`,
      );
    }
    await this.update(track.id, {
      ...track,
      status: TrackStatusEnum.Downloading,
      progress: 0,
    });
    let error: string;
    let lastProgress = -1;
    try {
      const folderName = this.getFolderName(track, track.playlist);
      const timeoutMs = Number(process.env.YT_DOWNLOAD_TIMEOUT_MS || 20 * 60 * 1000);
      const runWithTimeout = async <T>(
        operation: Promise<T>,
        label: string,
      ): Promise<T> => {
        if (!timeoutMs || Number.isNaN(timeoutMs) || timeoutMs <= 0) {
          return operation;
        }
        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<T>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new Error(`${label} timed out after ${timeoutMs}ms`),
              ),
            timeoutMs,
          );
        });
        try {
          return await Promise.race([operation, timeoutPromise]);
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }
      };

      await runWithTimeout(
        this.youtubeService.downloadAndFormat(track, folderName, async (percent) => {
          const rounded = Math.max(0, Math.min(100, Math.floor(percent)));
          if (rounded <= lastProgress) {
            return;
          }
          const latest = await this.get(track.id);
          if (latest?.status === TrackStatusEnum.Error && isUserStoppedError(latest?.error)) {
            return;
          }
          lastProgress = rounded;
          await this.update(track.id, {
            ...track,
            status: TrackStatusEnum.Downloading,
            progress: rounded,
          });
        }),
        'YouTube download',
      );
      if (coverUrl) {
        await runWithTimeout(
          this.youtubeService.addImage(
            folderName,
            coverUrl,
            track.name,
            track.artist,
          ),
          'Cover art fetch',
        );
      }
    } catch (err) {
      this.logger.error(err);
      error = String(err);
    }
    const updatedTrack = {
      ...track,
      status: error ? TrackStatusEnum.Error : TrackStatusEnum.Completed,
      ...(error ? {} : { progress: 100 }),
      ...(error ? { error } : {}),
    };
    const latest = await this.get(track.id);
    if (latest?.status === TrackStatusEnum.Error && isUserStoppedError(latest?.error)) {
      return;
    }
    await this.update(track.id, updatedTrack);
  }

  getTrackFileName(track: TrackEntity): string {
    const safeArtist = track.artist || 'unknown_artist';
    const safeName = (track.name || 'unknown_track').replace('/', '');
    const fileName = `${safeArtist} - ${safeName}`;
    return `${this.utilsService.stripFileIllegalChars(fileName)}.${this.configService.get<string>(EnvironmentEnum.FORMAT)}`;
  }

  getFolderName(track: TrackEntity, playlist: PlaylistEntity): string {
    // Individual tracks (isTrack=true) go in root downloads folder, playlists in subfolders
    if (playlist?.isTrack) {
      return resolve(
        this.utilsService.getRootDownloadsPath(),
        this.getTrackFileName(track),
      );
    }
    
    const safePlaylistName = playlist?.name || 'unknown_playlist';
    return resolve(
      this.utilsService.getPlaylistFolderPath(safePlaylistName),
      this.getTrackFileName(track),
    );
  }

  async forceFail(id: number): Promise<void> {
    const track = await this.get(id);
    if (!track) {
      return;
    }
    await this.update(id, {
      ...track,
      status: TrackStatusEnum.Error,
      error: `${FORCED_ERROR_PREFIX} at ${new Date().toISOString()}`,
    });
  }

  async stopByPlaylist(playlistId: number): Promise<void> {
    const tracks = await this.getAllByPlaylist(playlistId);
    for (const track of tracks) {
      if (track.status === TrackStatusEnum.Completed) {
        continue;
      }
      const jobId = `id-${track.id}`;
      await this.trackSearchQueue.remove(jobId);
      await this.trackDownloadQueue.remove(jobId);
      await this.update(track.id, {
        ...track,
        status: TrackStatusEnum.Error,
        error: `${STOPPED_ERROR_PREFIX} at ${new Date().toISOString()}`,
      });
    }
  }
}
