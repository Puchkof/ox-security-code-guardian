import { ScanStatus, Severity } from '@code-guardian/core';
import { Field, GraphQLISODateTime, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

/** GraphQL enum values are the object's keys, so key each severity by its wire value. */
const GqlSeverity: { readonly [S in Severity]: S } = {
  CRITICAL: Severity.Critical,
  HIGH: Severity.High,
  MEDIUM: Severity.Medium,
  LOW: Severity.Low,
  UNKNOWN: Severity.Unknown,
};

registerEnumType(ScanStatus, { name: 'ScanStatus' });
registerEnumType(GqlSeverity, { name: 'Severity' });

@ObjectType('Vulnerability')
export class VulnerabilityModel {
  @Field(() => String)
  vulnerabilityId!: string;

  @Field(() => String)
  pkgName!: string;

  @Field(() => String)
  installedVersion!: string;

  @Field(() => String, { nullable: true })
  fixedVersion!: string | null;

  @Field(() => GqlSeverity)
  severity!: Severity;

  @Field(() => String, { nullable: true })
  title!: string | null;

  @Field(() => String, { nullable: true })
  primaryUrl!: string | null;

  @Field(() => String, { description: 'Scanned file or artifact the finding belongs to' })
  target!: string;
}

@ObjectType('Scan')
export class ScanModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  repoUrl!: string;

  @Field(() => ScanStatus)
  status!: ScanStatus;

  @Field(() => String, { nullable: true })
  failureReason!: string | null;

  @Field(() => Int, { nullable: true })
  criticalCount!: number | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => [VulnerabilityModel], {
    nullable: true,
    description: 'One page of CRITICAL findings; null unless the scan is Finished',
  })
  criticalVulnerabilities!: readonly VulnerabilityModel[] | null;

  @Field(() => String, { nullable: true, description: 'Pass as `after` to fetch the next page' })
  nextCursor!: string | null;
}

@ObjectType('StartScanPayload')
export class StartScanPayload {
  @Field(() => ID)
  scanId!: string;

  @Field(() => ScanStatus)
  status!: ScanStatus;
}
