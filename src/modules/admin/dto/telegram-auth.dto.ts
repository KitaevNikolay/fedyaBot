import { IsOptional, IsString } from 'class-validator';

export class TelegramAuthDto {
  @IsString()
  id!: string;

  @IsString()
  first_name!: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  photo_url?: string;

  @IsString()
  auth_date!: string;

  @IsString()
  hash!: string;
}
