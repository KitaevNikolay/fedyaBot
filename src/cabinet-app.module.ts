import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppLoggerModule } from './common/logger/app-logger.module';
import { ConfigAppModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AdminModule } from './modules/admin/admin.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { UsersModule } from './modules/users/users.module';

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
    UsersModule,
    ArticlesModule,
    AdminModule,
  ],
})
export class CabinetAppModule {}
