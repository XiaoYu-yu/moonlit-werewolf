import {
  AI_PERSONALITIES,
  PLAYABLE_AI_PROVIDER_IDS,
  type AiPersonality,
  type PlayableAiProviderId,
} from '@werewolf/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @Length(4, 64)
  declare inviteCode: string;

  @Type(() => Number)
  @IsIn([6, 9, 12])
  declare preset: 6 | 9 | 12;

  @IsString()
  @Length(1, 20)
  declare nickname: string;
}

export class JoinRoomDto {
  @IsString()
  @Length(1, 20)
  declare nickname: string;
}

export class AiSeatDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  declare seatNumber: number;

  @IsString()
  @Length(1, 100)
  declare modelId: string;

  @IsIn([...PLAYABLE_AI_PROVIDER_IDS])
  declare providerId: PlayableAiProviderId;

  @IsIn([...AI_PERSONALITIES])
  declare personality: AiPersonality;
}

export class AiObserverSeatDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  declare seatNumber: number;

  @IsIn([...PLAYABLE_AI_PROVIDER_IDS])
  declare providerId: PlayableAiProviderId;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  declare modelId?: string;

  @IsIn([...AI_PERSONALITIES])
  declare personality: AiPersonality;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  declare nickname?: string;
}

export class ConfigureAiSeatsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiSeatDto)
  declare seats: AiSeatDto[];
}

export class CreateAiObserverRoomDto {
  @IsString()
  @Length(4, 64)
  declare inviteCode: string;

  @Type(() => Number)
  @IsIn([6, 9, 12])
  declare preset: 6 | 9 | 12;

  @IsArray()
  @ArrayMinSize(6)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => AiObserverSeatDto)
  declare lineup: AiObserverSeatDto[];
}

export class ReadyDto {
  @IsBoolean()
  declare ready: boolean;
}

export class ChatDto {
  @IsString()
  @Length(1, 2_000)
  declare message: string;
}

export class GameActionDto {
  @IsString()
  @Length(8, 100)
  declare idempotencyKey: string;

  @IsIn([
    'acknowledge_role',
    'guard',
    'werewolf_vote',
    'seer_check',
    'witch',
    'finish_speech',
    'day_vote',
    'hunter_shot',
  ])
  declare type:
    | 'acknowledge_role'
    | 'guard'
    | 'werewolf_vote'
    | 'seer_check'
    | 'witch'
    | 'finish_speech'
    | 'day_vote'
    | 'hunter_shot';

  @IsOptional()
  @IsString()
  @Length(1, 100)
  declare targetId?: string | null;

  @IsOptional()
  @IsBoolean()
  declare useHeal?: boolean;

  @ValidateIf((_, value: unknown) => value !== null && value !== undefined)
  @IsString()
  @Length(1, 100)
  declare poisonTargetId?: string | null;
}

export class HostControlDto {
  @IsIn(['pause', 'resume', 'advance'])
  declare command: 'pause' | 'resume' | 'advance';
}

export class RoomCodeDto {
  @IsString()
  @Matches(/^[A-Z0-9_-]{4,12}$/i)
  declare code: string;
}

export class ReadyEventDto extends RoomCodeDto {
  @ValidateNested()
  @Type(() => ReadyDto)
  declare payload: ReadyDto;
}

export class ChatEventDto extends RoomCodeDto {
  @ValidateNested()
  @Type(() => ChatDto)
  declare payload: ChatDto;
}

export class GameActionEventDto extends RoomCodeDto {
  @ValidateNested()
  @Type(() => GameActionDto)
  declare payload: GameActionDto;
}

export class HostControlEventDto extends RoomCodeDto {
  @ValidateNested()
  @Type(() => HostControlDto)
  declare payload: HostControlDto;
}
