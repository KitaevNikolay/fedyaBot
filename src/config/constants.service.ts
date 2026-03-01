import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class ConstantsService {
  private readonly constants: Record<string, unknown>;

  constructor() {
    const filePath = join(process.cwd(), 'config', 'constants', 'bot.json');
    const raw = readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid constants file');
    }
    this.constants = parsed as Record<string, unknown>;
  }

  get<T = string>(path: string): T {
    const parts = path.split('.');
    let current: unknown = this.constants;

    for (const part of parts) {
      if (typeof current !== 'object' || current === null) {
        return undefined as T;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current as T;
  }
}
