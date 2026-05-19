import { IsIn, IsString } from 'class-validator';

export class UpdateAdminUserRoleDto {
  @IsString()
  @IsIn(['admin', 'user'])
  role!: string;
}
