import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { LogAnalyticsService } from './log-analytics.service';

@Injectable()
export class AppLoggerService {
  private readonly filePath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logAnalyticsService: LogAnalyticsService,
  ) {
    const configured =
      this.configService.get<string>('LOG_FILE_PATH') ?? 'logs/app.log';
    this.filePath = resolve(configured);
  }

  async log(payload: Record<string, unknown>) {
    const record = {
      ...payload,
      timestamp: new Date().toISOString(),
    };

    try {
      const line = JSON.stringify(record);
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${line}\n`);
    } catch {
      // Best effort file logging, analytics persistence still continues.
    }

    void this.logAnalyticsService.ingestPayload(record);
  }
}
