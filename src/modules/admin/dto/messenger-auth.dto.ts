import { IsString, Length, Matches } from 'class-validator';

/** Логин Яндекса: латиница, цифры, точки, дефисы, подчёркивания, @домен */
const LOGIN_PATTERN = /^[a-zA-Z0-9._@-]+$/;

export class RequestAuthCodeDto {
  @IsString()
  @Length(1, 100)
  @Matches(LOGIN_PATTERN, { message: 'Некорректный логин' })
  login!: string;
}

export class VerifyAuthCodeDto {
  @IsString()
  @Length(1, 100)
  @Matches(LOGIN_PATTERN, { message: 'Некорректный логин' })
  login!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'Код состоит из 6 цифр' })
  code!: string;
}
