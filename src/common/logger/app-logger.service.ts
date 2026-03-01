import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';

@Injectable()
export class AppLoggerService {
  private readonly filePath: string;

  constructor(private readonly configService: ConfigService) {
    const configured =
      this.configService.get<string>('LOG_FILE_PATH') ?? 'logs/app.log';
    this.filePath = resolve(configured);
  }

  async log(payload: Record<string, unknown>) {
    try {
      const line = JSON.stringify({
        ...payload,
        timestamp: new Date().toISOString(),
      });
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${line}\n`);
    } catch {
      return;
    }
  }
}
