import { BadRequestException, Injectable } from '@nestjs/common';
import { BothubService } from '../bothub/bothub.service';
import { PROMPT_PLACEHOLDERS_BY_TYPE } from '../bothub/prompt-template.helpers';
import {
  GenerationSettingsDto,
  GenerationSettingsService,
} from '../generation-settings/generation-settings.service';
import {
  OutlineService,
  PromptDocumentSummary,
} from '../outline/outline.service';

export type UpdateGenerationSettingPayload = {
  typeName?: string | null;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  files?: string[];
  systemPromptId?: string | null;
  userPromptId?: string | null;
  additionalPayload?: Record<string, unknown> | null;
};

@Injectable()
export class AdminGenerationSettingsService {
  constructor(
    private readonly generationSettingsService: GenerationSettingsService,
    private readonly outlineService: OutlineService,
    private readonly bothubService: BothubService,
  ) {}

  async getGenerationSettings() {
    const settings = await this.generationSettingsService.getAll();
    const promptOptions = await this.getPromptOptionsForSettings(settings);

    return {
      promptOptions,
      settings: settings.map((setting) =>
        this.toGenerationSettingsResponse(setting, promptOptions),
      ),
    };
  }

  async updateGenerationSetting(
    type: string,
    payload: UpdateGenerationSettingPayload,
  ) {
    const normalizedPayload = this.normalizePayload(payload);
    const updated = await this.generationSettingsService.update(
      type,
      normalizedPayload,
    );
    const promptOptions = await this.getPromptOptionsForSettings([updated]);

    return this.toGenerationSettingsResponse(updated, promptOptions);
  }

  async getAvailableModels() {
    return this.bothubService.getAvailableModels();
  }

  private async getPromptOptionsForSettings(settings: GenerationSettingsDto[]) {
    const promptOptions = await this.outlineService.getPromptDocuments();
    const promptMap = new Map(promptOptions.map((prompt) => [prompt.id, prompt]));
    const promptIds = Array.from(
      new Set(
        settings
          .flatMap((setting) => [setting.systemPromptId, setting.userPromptId])
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (promptIds.length > 0) {
      const missingPromptIds = promptIds.filter((id) => !promptMap.has(id));
      const missingPrompts = await Promise.all(
        missingPromptIds.map((id) => this.resolvePromptDocument(id)),
      );

      for (const prompt of missingPrompts) {
        if (!prompt) {
          continue;
        }

        promptMap.set(prompt.id, prompt);
      }
    }

    return Array.from(promptMap.values()).sort((left, right) =>
      left.title.localeCompare(right.title, 'ru'),
    );
  }

  private toGenerationSettingsResponse(
    setting: GenerationSettingsDto,
    promptOptions: PromptDocumentSummary[],
  ) {
    const promptMap = new Map(promptOptions.map((prompt) => [prompt.id, prompt]));

    return {
      ...setting,
      systemPrompt: setting.systemPromptId
        ? promptMap.get(setting.systemPromptId) ?? null
        : null,
      userPrompt: setting.userPromptId
        ? promptMap.get(setting.userPromptId) ?? null
        : null,
      placeholders: PROMPT_PLACEHOLDERS_BY_TYPE[setting.type] ?? [],
    };
  }

  private normalizePayload(payload: UpdateGenerationSettingPayload) {
    if (
      payload.additionalPayload !== undefined &&
      payload.additionalPayload !== null &&
      (typeof payload.additionalPayload !== 'object' ||
        Array.isArray(payload.additionalPayload))
    ) {
      throw new BadRequestException(
        'additionalPayload must be an object or null',
      );
    }

    if (
      payload.files !== undefined &&
      (!Array.isArray(payload.files) ||
        payload.files.some((value) => typeof value !== 'string'))
    ) {
      throw new BadRequestException('files must be an array of strings');
    }

    return {
      typeName: this.normalizeNullableString(payload.typeName),
      model:
        payload.model !== undefined ? payload.model.trim() : payload.model,
      temperature: payload.temperature,
      maxTokens: payload.maxTokens,
      files:
        payload.files !== undefined
          ? payload.files.map((value) => value.trim())
          : undefined,
      systemPromptId: this.normalizeNullableString(payload.systemPromptId),
      userPromptId: this.normalizeNullableString(payload.userPromptId),
      additionalPayload: payload.additionalPayload,
    };
  }

  private normalizeNullableString(value?: string | null) {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private async resolvePromptDocument(id: string) {
    const promptDocument = await this.outlineService.getPromptDocumentSummary(id);

    if (promptDocument) {
      return promptDocument;
    }

    return {
      id,
      title: id,
      url: null,
    };
  }
}
