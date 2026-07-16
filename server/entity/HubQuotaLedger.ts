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
import { HubRequest } from './HubRequest';
import { User } from './User';

export enum HubQuotaLedgerState {
  RESERVED = 'reserved',
  CONSUMED = 'consumed',
  RELEASED = 'released',
}

@Entity()
@Index(['request'], { unique: true })
export class HubQuotaLedger {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => HubRequest, { onDelete: 'CASCADE' })
  public request: HubRequest;

  @Index()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  public user: User;

  @Column({ type: 'integer' })
  public points: number;

  @Column({ type: 'varchar', default: HubQuotaLedgerState.RESERVED })
  public state: HubQuotaLedgerState;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public consumedAt?: Date | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public releasedAt?: Date | null;

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
