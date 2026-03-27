import { IsBoolean } from 'class-validator';

export class UpdateAdminUserStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
