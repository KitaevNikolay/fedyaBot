import { Module } from '@nestjs/common';
import { ConstantsService } from './constants.service';
import { LocalesService } from './locales.service';

@Module({
  providers: [ConstantsService, LocalesService],
  exports: [ConstantsService, LocalesService],
})
export class ConfigAppModule {}
