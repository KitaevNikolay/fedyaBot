import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { AppLoggerService } from '../../common/logger/app-logger.service';

type TextRuResponse = {
  text_uid?: string;
  text_unique?: string;
  unique?: string;
  error_code?: string | number;
  error_desc?: string;
};

@Injectable()
export class TextRuService {
  private readonly logger = new Logger(TextRuService.name);
  private readonly apiUrl = 'https://api.text.ru/post';
  private readonly userKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly appLogger: AppLoggerService,
  ) {
    const key = this.configService.get<string>('TEXT_RU_API_KEY');
    if (!key) {
      this.logger.warn(
        'TEXT_RU_API_KEY is missing. Uniqueness check will not work.',
      );
    }
    this.userKey = key || '';
  }

  async createCheck(
    text: string,
    userContext?: Record<string, unknown>,
  ): Promise<string> {
    if (!this.userKey) {
      throw new Error('TEXT_RU_API_KEY is not configured');
    }
    const payload = {
      userkey: this.userKey,
      text,
    };

    await this.appLogger.log({
      type: 'external_request',
      integration: 'text_ru',
      method: 'POST',
      url: this.apiUrl,
      requestBody: { textLength: text.length },
      ...userContext,
    });

    try {
      const response$ = this.httpService.post(this.apiUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await lastValueFrom(response$);
      await this.appLogger.log({
        type: 'external_response',
        integration: 'text_ru',
        method: 'POST',
        url: this.apiUrl,
        status: response.status,
        responseBody: response.data,
        ...userContext,
      });

      const data = response.data as TextRuResponse;
      if (data.text_uid) {
        return data.text_uid;
      }

      const errorCode = data.error_code ?? 'unknown';
      const errorDesc = data.error_desc ?? 'Unknown error';
      throw new Error(`${errorCode}: ${errorDesc}`);
    } catch (error) {
      this.logger.error(`TextRu createCheck failed: ${error}`);
      const errorResponse = (
        error as { response?: { status?: number; data?: unknown } }
      ).response;
      await this.appLogger.log({
        type: 'external_error',
        integration: 'text_ru',
        method: 'POST',
        url: this.apiUrl,
        status: errorResponse?.status,
        responseBody: errorResponse?.data,
        error: error instanceof Error ? error.message : String(error),
        ...userContext,
      });
      throw error;
    }
  }

  async getResult(
    uid: string,
    userContext?: Record<string, unknown>,
  ): Promise<
    | { status: 'ready'; unique: string }
    | { status: 'pending' }
    | { status: 'error'; message: string }
  > {
    if (!this.userKey) {
      throw new Error('TEXT_RU_API_KEY is not configured');
    }
    const payload = {
      userkey: this.userKey,
      uid,
      jsonvisible: 'detail',
    };

    await this.appLogger.log({
      type: 'external_request',
      integration: 'text_ru',
      method: 'POST',
      url: this.apiUrl,
      requestBody: { uid },
      ...userContext,
    });

    try {
      const response$ = this.httpService.post(this.apiUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await lastValueFrom(response$);
      await this.appLogger.log({
        type: 'external_response',
        integration: 'text_ru',
        method: 'POST',
        url: this.apiUrl,
        status: response.status,
        responseBody: response.data,
        ...userContext,
      });

      const data = response.data as TextRuResponse;
      const unique = data.text_unique ?? data.unique;
      if (unique !== undefined) {
        return { status: 'ready', unique: unique.toString() };
      }

      const errorCode = data.error_code?.toString();
      if (errorCode === '181') {
        return { status: 'pending' };
      }

      const message =
        data.error_desc ?? `Unknown error${errorCode ? ` (${errorCode})` : ''}`;
      return { status: 'error', message };
    } catch (error) {
      this.logger.error(`TextRu getResult failed: ${error}`);
      const errorResponse = (
        error as { response?: { status?: number; data?: unknown } }
      ).response;
      await this.appLogger.log({
        type: 'external_error',
        integration: 'text_ru',
        method: 'POST',
        url: this.apiUrl,
        status: errorResponse?.status,
        responseBody: errorResponse?.data,
        error: error instanceof Error ? error.message : String(error),
        ...userContext,
      });
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
