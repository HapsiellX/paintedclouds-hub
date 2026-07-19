import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './User';

@Entity()
@Index(
  'IDX_hub_acquisition_issue_request',
  ['requestSource', 'requestId', 'is4k', 'partKey', 'reasonCode'],
  { unique: true }
)
@Index('IDX_hub_acquisition_issue_user_resolved', ['requestedBy', 'resolvedAt'])
@Index('IDX_hub_acquisition_issue_resolved', ['resolvedAt'])
export class HubAcquisitionIssue {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public requestSource: 'seerr' | 'hub';

  @Column({ type: 'integer' })
  public requestId: number;

  @Column({ type: 'varchar' })
  public kind: string;

  @Column({ type: 'varchar' })
  public externalId: string;

  @Column({ type: 'boolean', default: false })
  public is4k: boolean;

  @Column({ type: 'varchar' })
  public reasonCode: string;

  @Column({ type: 'varchar', default: '' })
  public partKey: string;

  @Column({ type: 'varchar' })
  public message: string;

  @Column({ type: 'boolean', default: true })
  public retryable: boolean;

  @ManyToOne(() => User, {
    eager: true,
    nullable: false,
    onDelete: 'CASCADE',
  })
  public requestedBy: User;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public acknowledgedAt?: Date | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public resolvedAt?: Date | null;

  @DbAwareColumn({ type: 'datetime' })
  public lastSeenAt: Date;

  @CreateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;
}
