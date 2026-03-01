import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { AppLoggerService } from '../../common/logger/app-logger.service';

@Injectable()
export class BitrixService {
  private readonly logger = new Logger(BitrixService.name);
  private readonly webhookUrl: string;
  private readonly defaultResponsibleId = 177990;
  private readonly auditors = [15924, 12776, 93413, 1206];
  private readonly groupId = 121;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly appLogger: AppLoggerService,
  ) {
    this.webhookUrl = this.configService.get<string>('BITRIX_WEBHOOK') || '';
    if (!this.webhookUrl) {
      this.logger.warn('BITRIX_WEBHOOK is not configured');
    }
  }

  async createTask(payload: {
    title: string;
    description: string;
    createdBy?: number;
    userContext?: Record<string, unknown>;
  }): Promise<number> {
    const { title, description, createdBy, userContext } = payload;

    const fields: any = {
      TITLE: title,
      DESCRIPTION: description,
      RESPONSIBLE_ID: this.defaultResponsibleId,
      AUDITORS: this.auditors,
      GROUP_ID: this.groupId,
    };

    if (createdBy) {
      fields.CREATED_BY = createdBy;
    }

    const url = `${this.webhookUrl}tasks.task.add`;

    await this.appLogger.log({
      type: 'external_request',
      integration: 'bitrix24',
      method: 'POST',
      url,
      requestBody: { fields },
      ...userContext,
    });

    try {
      const response$ = this.httpService.post(url, { fields });
      const response = await lastValueFrom(response$);

      await this.appLogger.log({
        type: 'external_response',
        integration: 'bitrix24',
        method: 'POST',
        url,
        status: response.status,
        responseBody: response.data,
        ...userContext,
      });

      if (response.data?.result?.task?.id) {
        return parseInt(response.data.result.task.id, 10);
      }

      throw new Error(
        `Failed to create task: ${JSON.stringify(response.data?.error_description || response.data)}`,
      );
    } catch (error) {
      this.logger.error(`Bitrix createTask failed: ${error}`);
      throw error;
    }
  }

  async uploadTaskFiles(
    taskId: number,
    files: Array<{ name: string; content: string }>,
    userContext?: Record<string, unknown>,
  ): Promise<void> {
    if (files.length === 0) return;

    for (const file of files) {
      const url = `${this.webhookUrl}task.item.addfile`;
      const payload = {
        TASK_ID: taskId,
        FILE: {
          NAME: file.name,
          CONTENT: file.content, // base64
        },
      };

      await this.appLogger.log({
        type: 'external_request',
        integration: 'bitrix24',
        method: 'POST',
        url,
        requestBody: { taskId, fileName: file.name },
        ...userContext,
      });

      try {
        const response$ = this.httpService.post(url, payload);
        const response = await lastValueFrom(response$);

        await this.appLogger.log({
          type: 'external_response',
          integration: 'bitrix24',
          method: 'POST',
          url,
          status: response.status,
          responseBody: response.data,
          ...userContext,
        });
      } catch (error) {
        this.logger.error(`Error uploading file ${file.name} to task ${taskId}: ${error}`);
        // Не выбрасываем ошибку, чтобы процесс продолжался
      }
    }
  }

  generateTaskUrl(taskId: number): string {
    try {
      const urlParts = this.webhookUrl.split('/');
      if (urlParts.length < 3 || !urlParts[2]) {
        throw new Error('Invalid webhook URL format');
      }
      const domain = urlParts[2];
      return `https://${domain}/workgroups/group/${this.groupId}/tasks/task/view/${taskId}/`;
    } catch (error) {
      this.logger.error(`Error generating task URL: ${error}`);
      return '';
    }
  }
}
