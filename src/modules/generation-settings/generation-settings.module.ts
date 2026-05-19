import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { GenerationSettingsService } from './generation-settings.service';

@Module({
  imports: [DatabaseModule],
  providers: [GenerationSettingsService],
  exports: [GenerationSettingsService],
})
export class GenerationSettingsModule {}
