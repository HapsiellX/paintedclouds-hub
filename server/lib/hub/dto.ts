import type {
  HubMediaKind,
  HubRequestFormat,
  HubRequestState,
} from '@server/constants/hub';
import type { HubRequest } from '@server/entity/HubRequest';
import type { User } from '@server/entity/User';

export const HUB_SUBMISSION_FAILED_MESSAGE =
  'Übermittlung an den Mediendienst fehlgeschlagen.';

interface HubUserDto {
  id: number;
  displayName: string;
  avatar: string;
}

export interface HubRequestDto {
  id: number;
  kind: HubMediaKind;
  provider: string;
  externalId: string;
  editionId?: string | null;
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  formats?: HubRequestFormat[] | null;
  languages?: string[] | null;
  state: HubRequestState;
  points: number;
  errorMessage?: string | null;
  requestedBy: HubUserDto;
  approvedBy?: HubUserDto | null;
  approvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt?: Date | null;
  targetService?: string | null;
  targetId?: string | null;
}

const toHubUserDto = (user: User): HubUserDto => ({
  id: user.id,
  displayName: user.displayName,
  avatar: user.avatar,
});

export const toHubRequestDto = (
  request: HubRequest,
  options: { admin: boolean }
): HubRequestDto => ({
  id: request.id,
  kind: request.kind,
  provider: request.provider,
  externalId: request.externalId,
  editionId: request.editionId,
  title: request.title,
  subtitle: request.subtitle,
  imageUrl: request.imageUrl,
  formats: request.formats,
  languages: request.languages,
  state: request.state,
  points: request.points,
  errorMessage:
    request.state === 'failed'
      ? HUB_SUBMISSION_FAILED_MESSAGE
      : request.errorMessage,
  requestedBy: toHubUserDto(request.requestedBy),
  approvedAt: request.approvedAt,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
  lastSyncedAt: request.lastSyncedAt,
  ...(options.admin
    ? {
        approvedBy: request.approvedBy
          ? toHubUserDto(request.approvedBy)
          : request.approvedBy,
        targetService: request.targetService,
        targetId: request.targetId,
      }
    : {}),
});
