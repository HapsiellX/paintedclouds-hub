import type { HubMediaKind, HubRequestFormat } from '@server/constants/hub';
import { resolveDbType } from '@server/utils/DbColumnHelper';
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
@Index(['user', 'provider', 'externalId', 'kind'], { unique: true })
export class HubUserSignal {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  public user: User;

  @Column({ type: 'varchar' })
  public kind: HubMediaKind;

  @Column({ type: 'varchar' })
  public provider: string;

  @Column({ type: 'varchar' })
  public externalId: string;

  @Column({ type: 'boolean', default: false })
  public liked: boolean;

  @Column({ type: 'boolean', default: false })
  public hidden: boolean;

  @Column({ type: 'boolean', default: false })
  public saved: boolean;

  // A small display snapshot makes the shared saved list usable without a
  // provider request. It is not used as behavioral tracking.
  @Column({ type: 'varchar', nullable: true })
  public title?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public subtitle?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public imageUrl?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  public genres?: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  public languages?: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  public formats?: HubRequestFormat[] | null;

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
