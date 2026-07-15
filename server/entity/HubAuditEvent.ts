import { resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { HubRequest } from './HubRequest';
import { User } from './User';

@Entity()
export class HubAuditEvent {
  @PrimaryGeneratedColumn()
  public id: number;

  @Index()
  @ManyToOne(() => HubRequest, { onDelete: 'CASCADE' })
  public request: HubRequest;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  public actor?: User | null;

  @Column({ type: 'varchar' })
  public action: string;

  @Column({ type: 'simple-json', nullable: true })
  public details?: Record<string, unknown> | null;

  @CreateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public createdAt: Date;
}
