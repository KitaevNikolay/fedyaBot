import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

@Injectable()
export class CompetitorsService {
  private readonly logger = new Logger(CompetitorsService.name);
  private competitors: string[] = [];
  private readonly competitorsFilePath = join(process.cwd(), 'docs', 'competitors.md');

  constructor() {
    this.loadCompetitors();
  }

  private loadCompetitors() {
    try {
      if (!existsSync(this.competitorsFilePath)) {
        this.logger.warn(`Competitors file not found at ${this.competitorsFilePath}`);
        return;
      }

      const content = readFileSync(this.competitorsFilePath, 'utf-8');
      this.competitors = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        // Разделяем строки с разделителями типа ' — ' или ' - '
        .flatMap(line => line.split(/\s*[-—]\s*/))
        .map(name => name.trim())
        .filter(name => name.length > 0);

      this.logger.log(`Loaded ${this.competitors.length} competitors for check.`);
    } catch (error) {
      this.logger.error(`Failed to load competitors: ${error.message}`);
    }
  }

  findCompetitors(text: string): string[] {
    if (!text || this.competitors.length === 0) return [];

    const found = new Set<string>();
    const lowerText = text.toLowerCase();

    for (const competitor of this.competitors) {
      // Используем RegExp для поиска точного вхождения слова (чтобы избежать частичных совпадений типа "СБИС" в "СБИС-технолоджи" - опционально)
      // Но по условию задачи просто вхождение. 
      // Для доменных имен и названий лучше искать целиком.
      if (lowerText.includes(competitor.toLowerCase())) {
        found.add(competitor);
      }
    }

    return Array.from(found);
  }
}
