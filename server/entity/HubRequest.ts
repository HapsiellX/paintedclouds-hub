import type { HubMediaKind, HubRequestFormat } from '@server/constants/hub';
import { HubRequestState } from '@server/constants/hub';
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
@Index(['provider', 'externalId', 'kind'], { unique: true })
export class HubRequest {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public kind: HubMediaKind;

  @Column({ type: 'varchar' })
  public provider: string;

  @Column({ type: 'varchar' })
  public externalId: string;

  @Column({ type: 'varchar' })
  public title: string;

  @Column({ type: 'varchar', nullable: true })
  public subtitle?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public imageUrl?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  public formats?: HubRequestFormat[] | null;

  @Column({ type: 'simple-json', nullable: true })
  public languages?: string[] | null;

  @Column({ type: 'varchar', default: HubRequestState.PENDING })
  public state: HubRequestState;

  @Column({ type: 'integer' })
  public points: number;

  @Column({ type: 'varchar', nullable: true })
  public targetService?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public targetId?: string | null;

  @Column({ type: 'text', nullable: true })
  public errorMessage?: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  public idempotencyKey: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  public requestedBy: User;

  @ManyToOne(() => User, { eager: true, nullable: true, onDelete: 'SET NULL' })
  public approvedBy?: User | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public approvedAt?: Date | null;

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

  constructor(init?: Partial<HubRequest>) {
    Object.assign(this, init);
  }
}
