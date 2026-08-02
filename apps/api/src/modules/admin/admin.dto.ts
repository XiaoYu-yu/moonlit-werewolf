import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateProviderDto {
  @IsOptional()
  @IsIn(['deepseek', 'kimi'])
  declare slug?: 'deepseek' | 'kimi';

  @IsString()
  @Length(2, 50)
  declare name: string;

  @IsIn(['openai-compatible'])
  declare kind: 'openai-compatible';

  @IsUrl({ require_tld: false })
  declare baseUrl: string;

  @IsString()
  @Length(8, 500)
  declare apiKey: string;

  @IsOptional()
  @IsBoolean()
  declare enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare concurrencyLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(120_000)
  declare timeoutMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  declare dailyBudgetCents?: number;
}

export class UpdateProviderDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  declare baseUrl?: string;

  @IsOptional()
  @IsString()
  @Length(8, 500)
  declare apiKey?: string;

  @IsOptional()
  @IsBoolean()
  declare enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare concurrencyLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(120_000)
  declare timeoutMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  declare dailyBudgetCents?: number;
}

export class CreateInviteDto {
  @IsString()
  @Length(1, 50)
  declare label: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  declare maxUses: number;

  @IsOptional()
  @IsString()
  declare expiresAt?: string;
}
