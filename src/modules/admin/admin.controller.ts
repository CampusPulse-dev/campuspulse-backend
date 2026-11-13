import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  AdminReportsQuery,
  AdminUsersQuery,
  AuditLogQuery,
  DecideVerificationBody,
  PutPlatformSettingBody,
  ResolveReportBody,
  SetUserSuspensionBody,
  UpdateUserRoleBody,
  VerificationQueueQuery,
} from '../../contract';
import { AuthGuard } from '../identity/auth';
import { AdminModerationService } from './admin-moderation.service';
import { AdminPlatformService } from './admin-platform.service';
import { AdminVerificationsService } from './admin-verifications.service';

const ref = (name: string) => ({ schema: { $ref: `#/components/schemas/${name}` } });

/**
 * Staff-only surface. Every route needs a staff role; the class-level list is
 * the widest set and individual routes narrow it. Student ID access is
 * additionally restricted to SUPER_ADMIN inside AdminVerificationsService.
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('VERIFIER', 'MODERATOR', 'SUPER_ADMIN')
export class AdminController {
  constructor(
    private readonly verifications: AdminVerificationsService,
    private readonly moderation: AdminModerationService,
    private readonly platform: AdminPlatformService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Queue counts and oldest-pending age for the SLA header' })
  @ApiOkResponse({ description: 'Counts scoped to the caller role.', ...ref('AdminOverview') })
  overview(@CurrentUser() actor: AuthenticatedUser) {
    return this.verifications.overview(actor);
  }

  // ── Verification queues ────────────────────────────────────────────────

  @Get('verifications')
  @Roles('VERIFIER', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Verification queue, oldest first (STUDENT_ID: Super Admin only)' })
  @ApiOkResponse({ description: 'Queue page.', ...ref('AdminVerificationQueueResponse') })
  listVerifications(
    @CurrentUser() actor: AuthenticatedUser,
    @Query(new ZodValidationPipe(VerificationQueueQuery)) query: VerificationQueueQuery,
  ) {
    return this.verifications.list(actor, query);
  }

  @Post('verifications/:id/claim')
  @HttpCode(200)
  @Roles('VERIFIER', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Take or extend the 15-minute review soft-lock' })
  @ApiOkResponse({ description: 'The claimed request.', ...ref('AdminVerificationItem') })
  claim(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.verifications.claim(actor, id);
  }

  @Get('verifications/:id/document')
  @Roles('SUPER_ADMIN')
  // NDPA: never cached, never offered as a download, never sniffed into another type.
  @Header('Cache-Control', 'no-store, private, max-age=0')
  @Header('Pragma', 'no-cache')
  @Header('Content-Disposition', 'inline')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @Header('Cross-Origin-Resource-Policy', 'same-site')
  @ApiOperation({
    summary: 'Stream a student ID image (Super Admin holding the claim; every view is audited)',
  })
  @ApiProduces('image/jpeg', 'image/png')
  @ApiOkResponse({ description: 'The image bytes. Not cacheable.' })
  async document(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const object = await this.verifications.openDocument(actor, id);
    return new StreamableFile(object.stream, {
      type: object.contentType,
      length: object.contentLength,
    });
  }

  @Post('verifications/:id/decide')
  @HttpCode(200)
  @Roles('VERIFIER', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Approve, reject or request info. Deletes any held ID image immediately.',
  })
  @ApiBody(ref('DecideVerificationBody'))
  @ApiOkResponse({ description: 'The decided request.', ...ref('AdminVerificationItem') })
  decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(DecideVerificationBody)) body: DecideVerificationBody,
  ) {
    return this.verifications.decide(actor, id, body);
  }

  // ── Moderation ─────────────────────────────────────────────────────────

  @Get('reports')
  @Roles('MODERATOR', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Moderation reports, oldest first' })
  @ApiOkResponse({ description: 'Reports page.', ...ref('AdminReportsResponse') })
  listReports(@Query(new ZodValidationPipe(AdminReportsQuery)) query: AdminReportsQuery) {
    return this.moderation.list(query);
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  @Roles('MODERATOR', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Dismiss, take down an event, remove a story, or suspend a user' })
  @ApiBody(ref('ResolveReportBody'))
  @ApiOkResponse({ description: 'The closed report.', ...ref('AdminReport') })
  resolveReport(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ResolveReportBody)) body: ResolveReportBody,
  ) {
    return this.moderation.resolve(actor, id, body);
  }

  // ── Users, settings, audit (Super Admin) ───────────────────────────────

  @Get('users')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Find accounts for role administration (emails masked)' })
  @ApiOkResponse({ description: 'Users page.', ...ref('AdminUsersResponse') })
  listUsers(@Query(new ZodValidationPipe(AdminUsersQuery)) query: AdminUsersQuery) {
    return this.platform.listUsers(query);
  }

  @Patch('users/:id/role')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Change an account role (audited; not your own)' })
  @ApiBody(ref('UpdateUserRoleBody'))
  @ApiOkResponse({ description: 'The updated account.', ...ref('AdminUser') })
  setRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateUserRoleBody)) body: UpdateUserRoleBody,
  ) {
    return this.platform.setRole(actor, id, body.role);
  }

  @Put('users/:id/suspension')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Suspend or reinstate an account (audited)' })
  @ApiBody(ref('SetUserSuspensionBody'))
  @ApiOkResponse({ description: 'The updated account.', ...ref('AdminUser') })
  setSuspension(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SetUserSuspensionBody)) body: SetUserSuspensionBody,
  ) {
    return this.platform.setSuspension(actor, id, body);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Runtime platform settings' })
  @ApiOkResponse({ description: 'All settings.', ...ref('PlatformSettingsResponse') })
  listSettings() {
    return this.platform.listSettings();
  }

  @Put('settings')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Create or change one platform setting (audited)' })
  @ApiBody(ref('PutPlatformSettingBody'))
  @ApiOkResponse({ description: 'All settings.', ...ref('PlatformSettingsResponse') })
  putSetting(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(PutPlatformSettingBody)) body: PutPlatformSettingBody,
  ) {
    return this.platform.putSetting(actor, body);
  }

  @Get('audit-logs')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Immutable audit log, newest first' })
  @ApiOkResponse({ description: 'Audit page.', ...ref('AuditLogResponse') })
  listAuditLogs(@Query(new ZodValidationPipe(AuditLogQuery)) query: AuditLogQuery) {
    return this.platform.listAuditLogs(query);
  }
}
