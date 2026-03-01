import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigAppModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { BotModule } from './modules/bot/bot.module';
import { BothubModule } from './modules/bothub/bothub.module';
import { GenerationSettingsModule } from './modules/generation-settings/generation-settings.module';
import { OutlineModule } from './modules/outline/outline.module';
import { RedisModule } from './modules/redis/redis.module';
import { ScenariosModule } from './modules/scenarios/scenarios.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { UsersModule } from './modules/users/users.module';
import { AppLoggerModule } from './common/logger/app-logger.module';

import { BitrixModule } from './modules/bitrix/bitrix.module';
import { TechnicalArticleAdditionsModule } from './modules/technical-article-additions/technical-article-additions.module';
import { TextRuModule } from './modules/text-ru/text-ru.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev',
    }),
    AppLoggerModule,
    ConfigAppModule,
    DatabaseModule,
    RedisModule,
    UsersModule,
    SessionsModule,
    ScenariosModule,
    ArticlesModule,
    BothubModule,
    GenerationSettingsModule,
    OutlineModule,
    TechnicalArticleAdditionsModule,
    TextRuModule,
    BitrixModule,
    BotModule,
  ],
})
export class AppModule {}
