import type { HubMediaKind } from '@server/constants/hub';
import { resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './User';

@Entity()
export class HubUserProfile {
  @PrimaryGeneratedColumn()
  public id: number;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  public user: User;

  @Column({ type: 'boolean', default: true })
  public enabled: boolean;

  @Column({ type: 'simple-json', nullable: true })
  public preferredMediaKinds?: HubMediaKind[] | null;

  @Column({ type: 'simple-json', nullable: true })
  public preferredGenres?: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  public preferredLanguages?: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  public musicGenres?: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  public musicArtists?: { id: string; name: string; type?: string }[] | null;

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
