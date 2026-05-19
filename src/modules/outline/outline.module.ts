import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { OutlineService } from './outline.service';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [OutlineService],
  exports: [OutlineService],
})
export class OutlineModule {}
