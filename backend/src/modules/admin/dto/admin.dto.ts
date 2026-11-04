import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ALLOWED_GRANT_TTLS } from '../../vault/dmp.service';

export class AdminLoginDto {
  @IsString() @Length(3, 64) username!: string;
  @IsString() @MinLength(1) @MaxLength(512) password!: string;
  @IsString() @Length(6, 6) totp!: string;
}

export class AdminStepUpDto {
  @IsString() @MinLength(1) @MaxLength(512) password!: string;
  @IsString() @Length(6, 6) totp!: string;
}

export class CreateClientDto {
  @IsString() @Length(1, 80) displayName!: string;

  @IsString()
  @Length(3, 64)
  @Matches(/^[a-z0-9._-]+$/i, { message: 'loginId may contain letters, digits, . _ -' })
  loginId!: string;

  @IsString() @MinLength(8) @MaxLength(512) password!: string;

  @IsOptional() @IsInt() maxDevices?: number;
}

export class SetClientAccessDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  categorySlugs?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true })
  documentIds?: string[];
}

export class UpdateDocumentDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(64) categorySlug?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  tags?: string[];

  @IsOptional() @IsISO8601() documentDate?: string;
}

/**
 * Setting the master password for the first time. There is no client-side
 * equivalent of this DTO anywhere in the project, by design.
 */
export class SetMasterPasswordDto {
  @IsString() @MinLength(8) @MaxLength(512) password!: string;
}

export class ChangeMasterPasswordDto {
  @IsString() @MinLength(1) @MaxLength(512) currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(512) newPassword!: string;
  @IsString() @MinLength(8) @MaxLength(512) confirmNewPassword!: string;
}

export class GrantTtlDto {
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsIn([...ALLOWED_GRANT_TTLS])
  seconds!: number;
}

export class AuditQueryDto {
  @IsOptional() @IsString() @MaxLength(64) event?: string;
  @IsOptional() @IsString() @MaxLength(16) result?: string;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  limit?: number;
}
