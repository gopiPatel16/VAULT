import { IsIn, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class EnrollDto {
  @IsString()
  @Length(10, 64)
  code!: string;

  /** P-256 public key, SPKI DER, base64. The curve is verified server-side. */
  @IsString()
  @Length(100, 200)
  publicKey!: string;

  @IsString()
  @Length(1, 64)
  @Matches(/^[\p{L}\p{N} ._'-]+$/u, {
    message: 'deviceName contains unsupported characters',
  })
  deviceName!: string;

  @IsIn(['ios', 'android', 'macos', 'windows', 'linux'])
  platform!: string;
}

export class LoginDto {
  @IsString()
  @Length(3, 64)
  loginId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @Length(20, 128)
  refreshToken!: string;
}
