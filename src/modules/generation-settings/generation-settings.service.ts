import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type GenerationSettingsDto = {
  type: string;
  typeName: string | null;
  model: string;
  temperature: number;
  maxTokens: number;
  files: string[];
  systemPromptId: string | null;
  userPromptId: string | null;
  additionalPayload: Record<string, any> | null;
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
      typeName: settings.typeName,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      files,
      systemPromptId: this.normalizeNullableText(settings.systemPromptId),
      userPromptId: this.normalizeNullableText(settings.userPromptId),
      additionalPayload: settings.additionalPayload as Record<string, any> | null,
    };
  }

  async getAll(): Promise<GenerationSettingsDto[]> {
    const settings = await this.prisma.generationSettings.findMany({
      orderBy: { type: 'asc' },
    });
    return settings.map((s) => ({
      type: s.type,
      typeName: s.typeName,
      model: s.model,
      temperature: s.temperature,
      maxTokens: s.maxTokens,
      files: this.parseFiles(s.files),
      systemPromptId: this.normalizeNullableText(s.systemPromptId),
      userPromptId: this.normalizeNullableText(s.userPromptId),
      additionalPayload: s.additionalPayload as Record<string, any> | null,
    }));
  }

  async update(
    type: string,
    data: Partial<Omit<GenerationSettingsDto, 'type'>>,
  ): Promise<GenerationSettingsDto> {
    const existing = await this.prisma.generationSettings.findUnique({
      where: { type },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Generation settings not found');
    }

    const updateData: Prisma.GenerationSettingsUpdateInput = {};

    if (data.typeName !== undefined) {
      updateData.typeName = data.typeName;
    }

    if (data.model !== undefined) {
      updateData.model = data.model;
    }

    if (data.temperature !== undefined) {
      updateData.temperature = data.temperature;
    }

    if (data.maxTokens !== undefined) {
      updateData.maxTokens = data.maxTokens;
    }

    if (data.systemPromptId !== undefined) {
      updateData.systemPromptId = data.systemPromptId;
    }

    if (data.userPromptId !== undefined) {
      updateData.userPromptId = data.userPromptId;
    }

    if (data.additionalPayload !== undefined) {
      updateData.additionalPayload =
        data.additionalPayload === null
          ? Prisma.DbNull
          : (data.additionalPayload as Prisma.InputJsonValue);
    }

    if (data.files !== undefined) {
      const files = data.files.filter((value) => typeof value === 'string');
      updateData.files = JSON.stringify(files);
    }

    const settings = await this.prisma.generationSettings.update({
      where: { type },
      data: updateData,
    });

    return {
      type: settings.type,
      typeName: settings.typeName,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      files: this.parseFiles(settings.files),
      systemPromptId: this.normalizeNullableText(settings.systemPromptId),
      userPromptId: this.normalizeNullableText(settings.userPromptId),
      additionalPayload: settings.additionalPayload as Record<string, any> | null,
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

  private normalizeNullableText(value: string | null) {
    if (value === null) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
