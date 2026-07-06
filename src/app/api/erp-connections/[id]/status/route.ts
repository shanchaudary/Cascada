// Cascada — ERP Connection Status API
// GET /api/erp-connections/:id/status
// Returns the current connection status and sync state

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import logger from '@/lib/logger';
import { AuthenticationError, AuthorizationError, NotFoundError } from '@/lib/errors';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    throw new AuthenticationError();
  }

  const userId = (session.user as Record<string, unknown>)['id'] as string;
  const tenantId = (session.user as Record<string, unknown>)['tenantId'] as string;

  if (!tenantId) {
    throw new AuthorizationError('No tenant context');
  }

  const { id } = await params;

  // Get the connection with latest sync log
  const connection = await prisma.erpConnection.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      erpType: true,
      connectionName: true,
      syncStatus: true,
      lastSyncAt: true,
      lastSyncError: true,
      syncState: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!connection) {
    throw new NotFoundError('ERP connection', id);
  }

  // Get the most recent sync log for each entity type
  const recentSyncs = await prisma.syncLog.findMany({
    where: { erpConnectionId: id },
    orderBy: { startedAt: 'desc' },
    take: 5,
  });

  // Get last successful sync per entity type
  const entityTypes = ['items', 'boms', 'suppliers', 'customers'];
  const lastSuccessfulSyncs: Record<string, { completedAt: Date | null; recordsSuccess: number } | null> = {};

  for (const entityType of entityTypes) {
    const lastSync = await prisma.syncLog.findFirst({
      where: {
        erpConnectionId: id,
        entityType,
        completedAt: { not: null },
      },
      orderBy: { startedAt: 'desc' },
      select: { completedAt: true, recordsSuccess: true },
    });
    lastSuccessfulSyncs[entityType] = lastSync
      ? { completedAt: lastSync.completedAt, recordsSuccess: lastSync.recordsSuccess }
      : null;
  }

  // Compute overall health
  const isHealthy = connection.syncStatus === 'CONNECTED' || connection.syncStatus === 'SYNCING';
  const hasRecentError = connection.lastSyncError !== null;
  const lastSyncAge = connection.lastSyncAt
    ? Date.now() - connection.lastSyncAt.getTime()
    : null;

  // If last sync was more than 24 hours ago and status is CONNECTED, it might be stale
  const isStale = lastSyncAge !== null && lastSyncAge > 24 * 60 * 60 * 1000 && connection.syncStatus === 'CONNECTED';

  const healthStatus = !isHealthy
    ? 'unhealthy'
    : hasRecentError
      ? 'degraded'
      : isStale
        ? 'stale'
        : 'healthy';

  logger.info({
    msg: 'ERP connection status retrieved',
    tenantId,
    userId,
    erpConnectionId: id,
    healthStatus,
  });

  return NextResponse.json({
    data: {
      id: connection.id,
      erpType: connection.erpType,
      connectionName: connection.connectionName,
      syncStatus: connection.syncStatus,
      lastSyncAt: connection.lastSyncAt,
      lastSyncError: connection.lastSyncError,
      syncState: connection.syncState,
      health: {
        status: healthStatus,
        isHealthy,
        isStale,
        hasRecentError,
        lastSyncAgeMs: lastSyncAge,
      },
      lastSuccessfulSyncs,
      recentSyncs: recentSyncs.map((s) => ({
        id: s.id,
        syncType: s.syncType,
        entityType: s.entityType,
        recordsTotal: s.recordsTotal,
        recordsSuccess: s.recordsSuccess,
        recordsFailed: s.recordsFailed,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        duration: s.duration,
      })),
      timestamps: {
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      },
    },
  });
}
