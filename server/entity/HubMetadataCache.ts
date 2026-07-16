import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
@Index(['provider', 'cacheKey'], { unique: true })
export class HubMetadataCache {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public provider: string;

  @Column({ type: 'varchar' })
  public cacheKey: string;

  @Column({ type: 'text' })
  public payload: string;

  @Column({ type: 'varchar', nullable: true })
  public etag?: string | null;

  @DbAwareColumn({ type: 'datetime' })
  public expiresAt: Date;

  @DbAwareColumn({ type: 'datetime' })
  public staleUntil: Date;

  @Column({ type: 'text', nullable: true })
  public lastError?: string | null;

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
