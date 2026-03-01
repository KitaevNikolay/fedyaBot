import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class LocalesService {
  private readonly messages: Record<string, unknown>;

  constructor() {
    const filePath = join(process.cwd(), 'config', 'locales', 'ru.json');
    const raw = readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid locales file');
    }
    this.messages = parsed as Record<string, unknown>;
  }

  t(key: string, args?: Record<string, string>): string {
    const parts = key.split('.');
    let current: unknown = this.messages;

    for (const part of parts) {
      if (typeof current !== 'object' || current === null) {
        return key;
      }
      current = (current as Record<string, unknown>)[part];
    }

    let message = (current as string) || key;

    if (args) {
      for (const [argKey, argValue] of Object.entries(args)) {
        message = message.replace(`{{${argKey}}}`, argValue);
      }
    }

    return message;
  }
}
