// Cascada — ERP Connection Sync Logs API
// GET /api/erp-connections/:id/sync-logs
// Returns paginated sync history for an ERP connection

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import logger from '@/lib/logger';
import { AuthenticationError, AuthorizationError, NotFoundError } from '@/lib/errors';
import { z } from 'zod';

const syncLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  entityType: z.string().optional(),
  syncType: z.enum(['full', 'incremental']).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    throw new AuthenticationError();
  }

  const userId = (session.user as Record<string, unknown>)['id'] as string;
  const tenantId = (session.user as Record<string, unknown>)['tenantId'] as string;
  const userRole = (session.user as Record<string, unknown>)['role'] as string;

  if (!tenantId) {
    throw new AuthorizationError('No tenant context');
  }

  const { id } = await params;

  // Verify the ERP connection belongs to this tenant
  const connection = await prisma.erpConnection.findFirst({
    where: { id, tenantId },
    select: { id: true, erpType: true, connectionName: true },
  });

  if (!connection) {
    throw new NotFoundError('ERP connection', id);
  }

  // Parse query parameters
  const searchParams = request.nextUrl.searchParams;
  const queryResult = syncLogsQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries())
  );

  if (!queryResult.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: queryResult.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
      },
      { status: 400 }
    );
  }

  const { page, limit, entityType, syncType } = queryResult.data;
  const skip = (page - 1) * limit;

  // Build where clause for sync logs
  const where: Record<string, unknown> = {
    erpConnectionId: id,
  };

  if (entityType) {
    where['entityType'] = entityType;
  }

  if (syncType) {
    where['syncType'] = syncType;
  }

  // Fetch sync logs with pagination
  const [logs, total] = await Promise.all([
    prisma.syncLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.syncLog.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);

  logger.info({
    msg: 'Sync logs retrieved',
    tenantId,
    userId,
    erpConnectionId: id,
    total,
    page,
  });

  return NextResponse.json({
    data: logs.map((log) => ({
      id: log.id,
      syncType: log.syncType,
      entityType: log.entityType,
      recordsTotal: log.recordsTotal,
      recordsSuccess: log.recordsSuccess,
      recordsFailed: log.recordsFailed,
      errorDetails: log.errorDetails,
      startedAt: log.startedAt,
      completedAt: log.completedAt,
      duration: log.duration,
      successRate: log.recordsTotal > 0
        ? Math.round((log.recordsSuccess / log.recordsTotal) * 100)
        : 0,
    })),
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    connection: {
      id: connection.id,
      erpType: connection.erpType,
      connectionName: connection.connectionName,
    },
  });
}
