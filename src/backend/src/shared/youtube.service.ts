import { Injectable, Logger } from '@nestjs/common';
import { TrackEntity } from '../track/track.entity';
import { EnvironmentEnum } from '../environmentEnum';
import { TrackService } from '../track/track.service';
import { ConfigService } from '@nestjs/config';
import { YtDlp } from 'ytdlp-nodejs';
import * as yts from 'yt-search';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
const NodeID3 = require('node-id3');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(TrackService.name);
  private cookiesFilePath?: string;

  constructor(private readonly configService: ConfigService) { }

  async findOnYoutubeOne(artist: string, name: string): Promise<string> {
    this.logger.debug(`Searching ${artist} - ${name} on YT`);
    const url = (await yts(`${artist} - ${name}`)).videos[0].url;
    this.logger.debug(`Found ${artist} - ${name} on ${url}`);
    return url;
  }

  async downloadAndFormat(
    track: TrackEntity,
    output: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    this.logger.debug(
      `Downloading ${track.artist} - ${track.name} (${track.youtubeUrl}) from YT`,
    );
    if (!track.youtubeUrl) {
      this.logger.error('youtubeUrl is null or undefined');
      throw Error('youtubeUrl is null or undefined');
    }
    const ytdlp = new YtDlp();
    const cookiesFile = this.getCookiesFilePath();
    const rawArgs = this.buildYtdlpArgs();
    const ytdlpEmitter = ytdlp as unknown as {
      on?: (event: string, handler: (err: unknown) => void) => void;
      off?: (event: string, handler: (err: unknown) => void) => void;
      removeListener?: (
        event: string,
        handler: (err: unknown) => void,
      ) => void;
    };
    let errorHandler: ((err: unknown) => void) | undefined;
    try {
      const errorPromise = new Promise<never>((_, reject) => {
        if (!ytdlpEmitter.on) {
          return;
        }
        errorHandler = (err: unknown) =>
          reject(err instanceof Error ? err : new Error(String(err)));
        ytdlpEmitter.on('error', errorHandler);
      });
      const downloadPromise = ytdlp.downloadAsync(track.youtubeUrl, {
        format: {
          filter: 'audioonly',
          type: this.configService.get<'m4a'>(EnvironmentEnum.FORMAT),
          quality: 0,
        },
        output,
        cookies: cookiesFile,
        headers: HEADERS,
        rawArgs,
        onProgress: (progress) => {
          this.logger.debug(
            `${track.artist} - ${track.name}: ${progress.percentage_str}`,
          );
          const percent = Number(
            String(progress.percentage_str || '')
              .replace('%', '')
              .trim(),
          );
          if (!Number.isNaN(percent)) {
            onProgress?.(percent);
          }
        },
      });
      await Promise.race([downloadPromise, errorPromise]);
    } catch (err) {
      const message = this.normalizeDownloadError(err);
      this.logger.error(message);
      throw new Error(message);
    } finally {
      if (errorHandler) {
        if (ytdlpEmitter.off) {
          ytdlpEmitter.off('error', errorHandler);
        } else if (ytdlpEmitter.removeListener) {
          ytdlpEmitter.removeListener('error', errorHandler);
        }
      }
    }
    this.logger.debug(
      `Downloaded ${track.artist} - ${track.name} to ${output}`,
    );
  }

  async addImage(
    folderName: string,
    coverUrl: string,
    title: string,
    artist: string,
  ): Promise<void> {
    if (coverUrl) {
      const res = await fetch(coverUrl);
      const arrayBuf = await res.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuf);

      NodeID3.write(
        {
          title,
          artist,
          APIC: {
            mime: 'image/jpeg',
            type: { id: 3, name: 'front cover' },
            description: 'cover',
            imageBuffer,
          },
        },
        folderName,
      );
    }
  }

  private getCookiesFilePath(): string | undefined {
    if (process.env.YT_COOKIES_FILE) {
      return process.env.YT_COOKIES_FILE;
    }
    if (!process.env.YT_COOKIES) {
      return undefined;
    }
    if (this.cookiesFilePath) {
      return this.cookiesFilePath;
    }
    const tmpDir = os.tmpdir();
    const filePath = join(tmpDir, 'spooty-yt-cookies.txt');
    fs.writeFileSync(filePath, process.env.YT_COOKIES);
    this.cookiesFilePath = filePath;
    return filePath;
  }

  private normalizeDownloadError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (
      /age|signin|sign in|account|login|confirm your age|members-only|private/i.test(
        raw,
      )
    ) {
      return (
        'YouTube download blocked (age-restricted or sign-in required). ' +
        'Provide valid cookies via YT_COOKIES or YT_COOKIES_FILE and retry.'
      );
    }
    if (/signature solving failed|challenge solving failed|EJS/i.test(raw)) {
      return (
        'YouTube download failed due to signature/challenge solving. ' +
        'Update yt-dlp/ytdlp-nodejs or ensure JS runtime + EJS components are available.'
      );
    }
    return raw;
  }

  private buildYtdlpArgs(): string[] {
    return [
      '--js-runtimes',
      'deno:/usr/bin/deno',
      '--remote-components',
      'ejs:github',
    ];
  }
}
