import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { AppLoggerService } from '../../common/logger/app-logger.service';

type OutlineApiResponse<T> = {
  data?: T;
  pagination?: unknown;
};

export interface Collection {
  id: string;
  name: string;
}

export interface OutlineDocument {
  id: string;
  title: string;
  text: string;
  url?: string | null;
  urlId?: string | null;
  collectionId?: string | null;
}

export interface PromptDocumentSummary {
  id: string;
  title: string;
  url: string | null;
}

@Injectable()
export class OutlineService implements OnModuleInit {
  private readonly logger = new Logger(OutlineService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly promptsConfigPath = join(
    process.cwd(),
    'config',
    'bothub',
    'config.json',
  );
  private readonly mapConfigPath = join(
    process.cwd(),
    'config',
    'bothub',
    'outline_map.json',
  );

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly appLogger: AppLoggerService,
  ) {
    const rawUrl =
      this.configService.get<string>('OUTLINE_API_URL') ||
      'http://localhost:3000/api';
    const normalizedUrl = rawUrl.replace(/\/+$/, '');
    this.apiUrl = normalizedUrl.endsWith('/api')
      ? normalizedUrl
      : `${normalizedUrl}/api`;
    this.apiKey = this.configService.get<string>('OUTLINE_API_KEY') ?? '';
  }

  async onModuleInit() {
    if (!this.apiKey) {
      this.logger.warn(
        'OUTLINE_API_KEY not set. Outline integration disabled.',
      );
      return;
    }
    const migrateOnStart =
      this.configService.get<string>('OUTLINE_MIGRATE_ON_START') === 'true';
    if (migrateOnStart || !existsSync(this.mapConfigPath)) {
      this.logger.log('Starting Outline prompts migration...');
      await this.migratePrompts();
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    data?: unknown,
    userContext?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.apiUrl}/${endpoint}`;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    try {
      await this.appLogger.log({
        type: 'external_request',
        integration: 'outline',
        method,
        url,
        requestBody: data ?? null,
        ...userContext,
      });
      const response$ =
        method === 'GET'
          ? this.httpService.get(url, { headers })
          : this.httpService.post(url, data, { headers });
      const response = await lastValueFrom(response$);
      await this.appLogger.log({
        type: 'external_response',
        integration: 'outline',
        method,
        url,
        status: response.status,
        responseBody: response.data,
        ...userContext,
      });
      const responseData = response.data as OutlineApiResponse<T> | T;
      if (
        responseData &&
        typeof responseData === 'object' &&
        'data' in responseData
      ) {
        const wrapped = responseData;
        if (wrapped.data !== undefined) {
          return wrapped.data;
        }
      }
      return responseData as T;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Outline API request failed: ${endpoint} - ${errorMessage}`,
      );
      const errorResponse = (
        error as { response?: { status?: number; data?: unknown } }
      ).response;
      await this.appLogger.log({
        type: 'external_error',
        integration: 'outline',
        method,
        url,
        status: errorResponse?.status,
        responseBody: errorResponse?.data,
        error: errorMessage,
        ...userContext,
      });
      const responseData = (error as { response?: { data?: unknown } }).response
        ?.data;
      if (responseData) {
        this.logger.error(`Response data: ${JSON.stringify(responseData)}`);
      }
      throw error;
    }
  }

  async createCollection(
    name: string,
    userContext?: Record<string, unknown>,
  ): Promise<Collection> {
    return this.request<Collection>(
      'POST',
      'collections.create',
      {
        name,
        permission: 'read_write',
      },
      userContext,
    );
  }

  async listCollections(
    userContext?: Record<string, unknown>,
  ): Promise<Collection[]> {
    return this.request<Collection[]>(
      'POST',
      'collections.list',
      undefined,
      userContext,
    );
  }

  async createDocument(
    collectionId: string,
    title: string,
    text: string,
    userContext?: Record<string, unknown>,
  ): Promise<OutlineDocument> {
    return this.request<OutlineDocument>(
      'POST',
      'documents.create',
      {
        collectionId,
        title,
        text,
        publish: true,
      },
      userContext,
    );
  }

  async getDocument(
    id: string,
    userContext?: Record<string, unknown>,
  ): Promise<OutlineDocument> {
    return this.request<OutlineDocument>(
      'POST',
      'documents.info',
      { id },
      userContext,
    );
  }

  async listDocuments(
    collectionId?: string,
    userContext?: Record<string, unknown>,
  ): Promise<OutlineDocument[]> {
    const payload = collectionId
      ? {
          collectionId,
          sort: 'title',
        }
      : {
          sort: 'title',
        };

    return this.request<OutlineDocument[]>(
      'POST',
      'documents.list',
      payload,
      userContext,
    );
  }

  getWorkspaceUrl() {
    return this.apiUrl.replace(/\/api$/, '');
  }

  async getPromptDocumentSummary(
    id: string,
    userContext?: Record<string, unknown>,
  ): Promise<PromptDocumentSummary | null> {
    try {
      const document = await this.getDocument(id, userContext);
      return this.toPromptDocumentSummary(document);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to fetch Outline prompt metadata for ${id}: ${errorMessage}`,
      );
      return null;
    }
  }

  async getPromptDocuments(
    userContext?: Record<string, unknown>,
  ): Promise<PromptDocumentSummary[]> {
    const documentMap = new Map<string, PromptDocumentSummary>();

    if (this.apiKey) {
      try {
        const collections = await this.listCollections(userContext);
        const promptsCollection = collections.find(
          (collection) => collection.name === 'prompts',
        );

        if (promptsCollection) {
          const documents = await this.listDocuments(
            promptsCollection.id,
            userContext,
          );

          for (const document of documents) {
            documentMap.set(
              document.id,
              this.toPromptDocumentSummary(document),
            );
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to load prompt list from Outline: ${errorMessage}`,
        );
      }
    }

    const mappedPromptIds = this.readMappedPromptIds();
    const missingIds = mappedPromptIds.filter((id) => !documentMap.has(id));

    if (missingIds.length > 0 && this.apiKey) {
      const promptDocuments = await Promise.all(
        missingIds.map((id) => this.getPromptDocumentSummary(id, userContext)),
      );

      for (const document of promptDocuments) {
        if (!document) {
          continue;
        }

        documentMap.set(document.id, document);
      }
    }

    return Array.from(documentMap.values()).sort((left, right) =>
      left.title.localeCompare(right.title, 'ru'),
    );
  }

  async getPromptById(
    id: string,
    userContext?: Record<string, unknown>,
  ): Promise<string | null> {
    try {
      const doc = await this.getDocument(id, userContext);
      return doc.text;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch prompt by id: ${errorMessage}`);
      return null;
    }
  }

  async migratePrompts() {
    try {
      const rawConfig = readFileSync(this.promptsConfigPath, 'utf-8');
      const config = JSON.parse(rawConfig) as { prompts?: unknown };
      const prompts = config.prompts;

      if (!prompts || typeof prompts !== 'object') {
        this.logger.warn('No prompts found in config.');
        return;
      }

      const collections = await this.listCollections();
      let collection = collections.find((c) => c.name === 'prompts');

      if (!collection) {
        this.logger.log('Creating prompts collection...');
        collection = await this.createCollection('prompts');
      } else {
        this.logger.log('Prompts collection already exists.');
      }

      const mapping: Record<string, string> = {};

      for (const [key, content] of Object.entries(
        prompts as Record<string, unknown>,
      )) {
        if (typeof content !== 'string') {
          continue;
        }
        this.logger.log(`Migrating prompt: ${key}`);
        const doc = await this.createDocument(collection.id, key, content);
        mapping[key] = doc.id;
      }

      writeFileSync(this.mapConfigPath, JSON.stringify(mapping, null, 2));
      this.logger.log(
        `Migration completed. Mapping saved to ${this.mapConfigPath}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Migration failed: ${errorMessage}`);
    }
  }

  async getPrompt(
    key: string,
    userContext?: Record<string, unknown>,
  ): Promise<string | null> {
    if (!existsSync(this.mapConfigPath)) {
      this.logger.warn(`Map file not found at ${this.mapConfigPath}`);
      return null;
    }
    const rawMap = readFileSync(this.mapConfigPath, 'utf-8');
    const parsed = JSON.parse(rawMap) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      this.logger.warn(`Invalid map file at ${this.mapConfigPath}`);
      return null;
    }
    const mapping = parsed as Record<string, string>;
    const docId = mapping[key];

    if (!docId) {
      this.logger.warn(`Prompt key ${key} not found in map.`);
      return null;
    }

    try {
      const doc = await this.getDocument(docId, userContext);
      return doc.text;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to fetch prompt ${key}: ${errorMessage}`);
      return null;
    }
  }

  private readMappedPromptIds() {
    if (!existsSync(this.mapConfigPath)) {
      return [];
    }

    try {
      const rawMap = readFileSync(this.mapConfigPath, 'utf-8');
      const parsed = JSON.parse(rawMap) as unknown;

      if (!parsed || typeof parsed !== 'object') {
        return [];
      }

      return Object.values(parsed).filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to read Outline prompt map: ${errorMessage}`);
      return [];
    }
  }

  private toPromptDocumentSummary(
    document: OutlineDocument,
  ): PromptDocumentSummary {
    return {
      id: document.id,
      title: document.title?.trim() || document.id,
      url: this.resolveDocumentUrl(document),
    };
  }

  private resolveDocumentUrl(document: OutlineDocument) {
    const workspaceUrl = this.getWorkspaceUrl();

    if (document.url) {
      if (/^https?:\/\//i.test(document.url)) {
        return document.url;
      }

      const normalizedPath = document.url.replace(/^\/+/, '');
      return `${workspaceUrl}/${normalizedPath}`;
    }

    if (document.urlId) {
      return `${workspaceUrl}/doc/${document.urlId}`;
    }

    return null;
  }
}
