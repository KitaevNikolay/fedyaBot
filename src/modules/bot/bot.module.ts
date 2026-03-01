import { Module } from '@nestjs/common';
import { ConfigAppModule } from '../../config/config.module';
import { ArticlesModule } from '../articles/articles.module';
import { BothubModule } from '../bothub/bothub.module';
import { GenerationSettingsModule } from '../generation-settings/generation-settings.module';
import { RedisModule } from '../redis/redis.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TechnicalArticleAdditionsModule } from '../technical-article-additions/technical-article-additions.module';
import { TextRuModule } from '../text-ru/text-ru.module';
import { UsersModule } from '../users/users.module';
import { BitrixModule } from '../bitrix/bitrix.module';
import { BotService } from './bot.service';

@Module({
  imports: [
    ConfigAppModule,
    UsersModule,
    SessionsModule,
    ScenariosModule,
    ArticlesModule,
    BothubModule,
    GenerationSettingsModule,
    RedisModule,
    TechnicalArticleAdditionsModule,
    TextRuModule,
    BitrixModule,
  ],
  providers: [BotService],
})
export class BotModule {}
