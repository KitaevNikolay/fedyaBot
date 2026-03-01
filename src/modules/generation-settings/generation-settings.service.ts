import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type GenerationSettingsDto = {
  type: string;
  model: string;
  temperature: number;
  maxTokens: number;
  files: string[];
  systemPromptId: string | null;
  userPromptId: string | null;
};

@Injectable()
export class GenerationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getByType(type: string): Promise<GenerationSettingsDto | null> {
    const settings = await this.prisma.generationSettings.findUnique({
      where: { type },
    });

    if (!settings) {
      return null;
    }

    const files = this.parseFiles(settings.files);

    return {
      type: settings.type,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      files,
      systemPromptId: settings.systemPromptId,
      userPromptId: settings.userPromptId,
    };
  }

  async getAll(): Promise<GenerationSettingsDto[]> {
    const settings = await this.prisma.generationSettings.findMany();
    return settings.map((s) => ({
      type: s.type,
      model: s.model,
      temperature: s.temperature,
      maxTokens: s.maxTokens,
      files: this.parseFiles(s.files),
      systemPromptId: s.systemPromptId,
      userPromptId: s.userPromptId,
    }));
  }

  async update(
    type: string,
    data: Partial<Omit<GenerationSettingsDto, 'type'>>,
  ): Promise<GenerationSettingsDto> {
    const { files, ...rest } = data;
    const updateData: Prisma.GenerationSettingsUpdateInput = { ...rest };
    if (files) {
      updateData.files = JSON.stringify(files);
    }

    const settings = await this.prisma.generationSettings.update({
      where: { type },
      data: updateData,
    });

    return {
      type: settings.type,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      files: this.parseFiles(settings.files),
      systemPromptId: settings.systemPromptId,
      userPromptId: settings.userPromptId,
    };
  }

  private parseFiles(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((v) => typeof v === 'string')
        : [];
    } catch {
      return [];
    }
  }
}
