<?php
/** Route group: ADMIN: SET CLIENT PASSWORD & VIEW PASSWORD (included by index.php in order; uses its request globals). */

declare(strict_types=1);

function mongoAdminPasswordRouteMatch(string $apiPath, string $method): ?array {
    if ($method === 'GET'
        && preg_match('#^/admin/clients/([^/]+)/portal-password$#', $apiPath, $matches)) {
        return ['action' => 'view', 'client_id' => rawurldecode($matches[1])];
    }
    if ($method === 'POST'
        && preg_match('#^/admin/users/([^/]+)/set-password$#', $apiPath, $matches)) {
        return ['action' => 'set', 'client_id' => rawurldecode($matches[1]), 'client_route' => false];
    }
    if ($method === 'POST'
        && preg_match('#^/admin/clients/([^/]+)/set-password$#', $apiPath, $matches)) {
        return ['action' => 'set', 'client_id' => rawurldecode($matches[1]), 'client_route' => true];
    }
    return null;
}

function mongoAdminPasswordEmailFilter(string $email): array {
    return ['email' => [
        '$regex' => '^\\s*' . preg_quote(strtolower(trim($email)), '/') . '\\s*$',
        '$options' => 'i',
    ]];
}

function mongoAdminPasswordActorCanViewClient(array $actor, array $client): bool {
    if (($actor['role'] ?? null) === 'Super Admin') return true;
    if (($actor['role'] ?? null) === 'Office Manager') {
        return ($client['assigned_office_id'] ?? '') !== ''
            && ($client['assigned_office_id'] ?? null) === ($actor['office_id'] ?? null);
    }
    if (($actor['role'] ?? null) === 'Team Leader') {
        return (!empty($actor['team_id'])
                && ($client['assigned_team_id'] ?? null) === $actor['team_id'])
            || ($client['assigned_team_leader_id'] ?? null) === ($actor['id'] ?? null);
    }
    if (($actor['role'] ?? null) === 'Agent') {
        return ($client['assigned_agent_id'] ?? null) === ($actor['id'] ?? null);
    }
    return false;
}

function mongoAdminPasswordAccessWriteSpec(
    bool $clientRoute,
    bool $accessExists,
    string $clientId,
    string $passwordHash,
    string $encryptedPassword,
    string $now,
): array {
    $updates = [
        'password_hash' => $passwordHash,
        'admin_view_password_enc' => $encryptedPassword,
    ];
    if ($clientRoute) {
        $updates['status'] = 'Active';
        $updates['portal_enabled'] = 1;
    }

    $insert = [
        'client_id' => $clientId,
        ...$updates,
        'status' => 'Active',
        'portal_enabled' => 1,
        'created_at' => $now,
    ];
    if ($clientRoute) {
        $insert['tier'] = 'Enterprise Partner';
    }

    return [
        'filter' => ['client_id' => $clientId],
        'updates' => $updates,
        'insert' => $insert,
        'access_exists' => $accessExists,
    ];
}

function mongoAdminPasswordTransaction(callable $operation): mixed {
    $session = getMongoDatabase()->getManager()->startSession();
    $session->startTransaction();
    try {
        $result = $operation($session);
        $session->commitTransaction();
        return $result;
    } catch (Throwable $error) {
        if ($session->isInTransaction()) {
            $session->abortTransaction();
        }
        throw $error;
    }
}

// -----------------------------------------------------------------------------
// 5. ADMIN: SET CLIENT PASSWORD & VIEW PASSWORD
// -----------------------------------------------------------------------------
if (isMongoStorageEnabled()) {
    $mongoPasswordRoute = mongoAdminPasswordRouteMatch($apiPath, $method);
    if ($mongoPasswordRoute !== null) {
        $passwordActor = mongoAdminClientActiveActor($adminSession);
        if (($passwordActor['role'] ?? null) !== 'Super Admin'
            && ($passwordActor['capabilities']['security'] ?? true) === false) {
            jsonResponse(['ok' => false, 'error' => 'This CRM tool is not enabled for your account.'], 403);
        }

        $clientId = $mongoPasswordRoute['client_id'];
        $client = mongoFindOne('clients', ['id' => $clientId, 'deleted_at' => null]);
        if (!$client) {
            jsonResponse(['ok' => false, 'error' => 'Client record not found.'], 404);
        }
        if (!mongoAdminPasswordActorCanViewClient($passwordActor, $client)) {
            jsonResponse(['ok' => false, 'error' => 'You cannot access this client record.'], 403);
        }

        if ($mongoPasswordRoute['action'] === 'view') {
            $access = mongoFindOne('client_portal_access', ['client_id' => $clientId]);
            $encryptedPassword = $access['admin_view_password_enc'] ?? null;
            if (!is_string($encryptedPassword) || $encryptedPassword === '') {
                header('Cache-Control: no-store, private');
                jsonResponse(['ok' => true, 'password' => null]);
            }

            try {
                $plainPassword = decryptClientSecret($encryptedPassword);
            } catch (Throwable $error) {
                error_log('[admin/portal-password] Decryption failed for a client portal password: ' . $error->getMessage());
                jsonResponse(['ok' => false, 'error' => 'The saved portal password cannot be opened. Check the credential encryption configuration.'], 503);
            }
            header('Cache-Control: no-store, private');
            mongoInsert('audit_logs', [
                'id' => 'aud_' . bin2hex(random_bytes(8)),
                'user_id' => $passwordActor['id'],
                'action' => 'CLIENT_PORTAL_PASSWORD_VIEWED',
                'details' => 'Viewed encrypted portal password for client ' . $clientId,
                'created_at' => date('c'),
            ]);
            jsonResponse(['ok' => true, 'password' => $plainPassword]);
        }

        $newPassword = trim((string)($input['password'] ?? $input['new_password'] ?? $input['client_password'] ?? ''));
        if (strlen($newPassword) < 8 || strlen($newPassword) > 4096) {
            jsonResponse(['ok' => false, 'error' => 'Password must contain at least 8 characters.'], 422);
        }

        $now = date('c');
        $clientRoute = $mongoPasswordRoute['client_route'];
        $clientEmail = '';
        if ($clientRoute) {
            $clientEmail = strtolower(trim((string)($client['email'] ?? '')));
            if (!filter_var($clientEmail, FILTER_VALIDATE_EMAIL)) {
                jsonResponse(['ok' => false, 'error' => 'Add a valid email to this client before creating portal access.'], 400);
            }
        }

        $passwordHash = password_hash($newPassword, PASSWORD_DEFAULT);
        if ($passwordHash === false) {
            jsonResponse(['ok' => false, 'error' => 'Could not securely save the client password.'], 500);
        }
        $encryptedPassword = encryptClientSecret($newPassword);

        $passwordChange = mongoAdminPasswordTransaction(
            static function ($session) use (
                $client,
                $clientId,
                $clientEmail,
                $clientRoute,
                $passwordHash,
                $encryptedPassword,
                $now,
            ): array {
                if ($clientRoute) {
                    $matches = getMongoCollection(mongoCollectionName('clients'))->find(
                        mongoAdminPasswordEmailFilter($clientEmail),
                        ['session' => $session, 'projection' => ['id' => 1, 'email' => 1]],
                    );
                    $matchingClientCount = 0;
                    foreach ($matches as $match) {
                        $matchingEmail = strtolower(trim((string)($match['email'] ?? '')));
                        if ($matchingEmail === $clientEmail) {
                            $matchingClientCount++;
                            if ($matchingClientCount > 1) break;
                        }
                    }
                    if ($matchingClientCount > 1) {
                        return ['identity_review_required' => true];
                    }
                }

                $accessCollection = getMongoCollection(mongoCollectionName('client_portal_access'));
                $existingAccess = $accessCollection->find(
                    ['client_id' => $clientId],
                    ['session' => $session, 'limit' => 2, 'projection' => ['client_id' => 1]],
                );
                $accessCount = 0;
                foreach ($existingAccess as $_access) {
                    $accessCount++;
                }
                if ($accessCount > 1) {
                    throw new RuntimeException('Multiple portal-access records exist for one client.');
                }
                $write = mongoAdminPasswordAccessWriteSpec(
                    $clientRoute,
                    $accessCount === 1,
                    $clientId,
                    $passwordHash,
                    $encryptedPassword,
                    $now,
                );
                if ($accessCount === 1) {
                    $accessCollection->updateOne(
                        $write['filter'],
                        ['$set' => $write['updates']],
                        ['session' => $session],
                    );
                } else {
                    $accessCollection->insertOne($write['insert'], ['session' => $session]);
                }

                $clientResult = getMongoCollection(mongoCollectionName('clients'))->updateOne(
                    ['id' => $clientId],
                    ['$set' => ['updated_at' => $now]],
                    ['session' => $session],
                );
                if ($clientResult->getMatchedCount() !== 1) {
                    throw new RuntimeException('Client record changed while updating portal access.');
                }

                getMongoCollection(mongoCollectionName('audit_logs'))->insertOne([
                    'id' => 'aud_' . time() . '_' . substr(bin2hex(random_bytes(3)), 0, 4),
                    'user_id' => $clientId,
                    'action' => 'PASSWORD_RESET',
                    'details' => 'Admin updated client portal password',
                    'created_at' => $now,
                ], ['session' => $session]);

                return ['created' => $accessCount === 0, 'identity_review_required' => false];
            },
        );

        if ($passwordChange['identity_review_required']) {
            jsonResponse([
                'ok' => false,
                'code' => 'CLIENT_IDENTITY_REVIEW_REQUIRED',
                'field' => 'email',
                'error' => 'This email is linked to multiple Client records. Resolve the identity review before enabling portal access.',
            ], 409);
        }

        jsonResponse([
            'ok' => true,
            'message' => 'Client portal password updated successfully.',
            'client_id' => $clientId,
            'client_account_created' => $clientRoute ? $passwordChange['created'] : false,
        ]);
    }
}

if (preg_match('#^/admin/clients/([^/]+)/portal-password$#', $apiPath, $portalPasswordMatch) && $method === 'GET') {
    $actor = requireAdminCapability($pdo, $adminSession, 'security');
    $clientId = rawurldecode($portalPasswordMatch[1]);
    requireVisibleClient($pdo, $actor, $clientId);

    $passwordStmt = $pdo->prepare('SELECT admin_view_password_enc FROM client_portal_access WHERE client_id = ?');
    $passwordStmt->execute([$clientId]);
    $encryptedPassword = $passwordStmt->fetchColumn();
    if (!is_string($encryptedPassword) || $encryptedPassword === '') {
        header('Cache-Control: no-store, private');
        jsonResponse(['ok' => true, 'password' => null]);
    }

    try {
        $plainPassword = decryptClientSecret($encryptedPassword);
    } catch (Throwable $error) {
        error_log('[admin/portal-password] Decryption failed for a client portal password: ' . $error->getMessage());
        jsonResponse(['ok' => false, 'error' => 'The saved portal password cannot be opened. Check the credential encryption configuration.'], 503);
    }
    header('Cache-Control: no-store, private');
    $pdo->prepare('INSERT INTO audit_logs (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)')
        ->execute([
            'aud_' . bin2hex(random_bytes(8)),
            $actor['id'],
            'CLIENT_PORTAL_PASSWORD_VIEWED',
            'Viewed encrypted portal password for client ' . $clientId,
            date('c'),
        ]);
    jsonResponse(['ok' => true, 'password' => $plainPassword]);
}

if (
    (preg_match('#^/admin/users/([^/]+)/set-password$#', $apiPath, $userPasswordMatch)
        || preg_match('#^/admin/clients/([^/]+)/set-password$#', $apiPath, $clientPasswordMatch))
    && $method === 'POST'
) {
    $passwordActor = requireAdminCapability($pdo, $adminSession, 'security');
    $isClientPassword = isset($clientPasswordMatch[1]);
    $userId = rawurldecode($isClientPassword ? $clientPasswordMatch[1] : $userPasswordMatch[1]);
    $newPassword = trim((string)($input['password'] ?? $input['new_password'] ?? $input['client_password'] ?? ''));
    if (strlen($newPassword) < 8 || strlen($newPassword) > 4096) {
        jsonResponse(['ok' => false, 'error' => 'Password must contain at least 8 characters.'], 422);
    }

    $now = date('c');
    requireVisibleClient($pdo, $passwordActor, $userId);
    if ($isClientPassword) {
        $clientstmt = $pdo->prepare('SELECT id, name, company, email, phone, country, country_code, created_at FROM clients WHERE id = ?');
        $clientstmt->execute([$userId]);
        $client = $clientstmt->fetch();
        if (!$client) jsonResponse(['ok' => false, 'error' => 'Client not found.'], 404);
        $clientEmail = strtolower(trim((string)($client['email'] ?? '')));
        if (!filter_var($clientEmail, FILTER_VALIDATE_EMAIL)) {
            jsonResponse(['ok' => false, 'error' => 'Add a valid email to this client before creating portal access.'], 400);
        }
        $client['email'] = $clientEmail;

        $pdo->beginTransaction();
        try {
            $emailCount = $pdo->prepare("SELECT COUNT(*) FROM clients WHERE LOWER(TRIM(email)) = ?");
            $emailCount->execute([$clientEmail]);
            if ((int)$emailCount->fetchColumn() > 1) {
                $pdo->rollBack();
                jsonResponse([
                    'ok' => false,
                    'code' => 'CLIENT_IDENTITY_REVIEW_REQUIRED',
                    'field' => 'email',
                    'error' => 'This email is linked to multiple Client records. Resolve the identity review before enabling portal access.',
                ], 409);
            }
            $portalClient = ensurePortalClientAccess($pdo, $client, $newPassword, $now);
            $pdo->prepare('UPDATE clients SET updated_at = ? WHERE id = ?')->execute([$now, $userId]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        $clientId = $portalClient['id'];
        $accountCreated = $portalClient['created'];
    } else {
        $clientStmt = $pdo->prepare('SELECT id, email FROM clients WHERE id = ? LIMIT 1');
        $clientStmt->execute([$userId]);
        $client = $clientStmt->fetch();
        if (!$client) {
            jsonResponse(['ok' => false, 'error' => 'Client not found. Use the Client ID.'], 404);
        }

        $passwordHash = password_hash($newPassword, PASSWORD_DEFAULT);
        if ($passwordHash === false) jsonResponse(['ok' => false, 'error' => 'Could not securely save the client password.'], 500);
        $encryptedPassword = encryptClientSecret($newPassword);
        $pdo->beginTransaction();
        try {
            $accessExists = $pdo->prepare('SELECT client_id FROM client_portal_access WHERE client_id = ?');
            $accessExists->execute([$client['id']]);
            if ($accessExists->fetchColumn()) {
                $pdo->prepare('UPDATE client_portal_access SET password_hash = ?, admin_view_password_enc = ? WHERE client_id = ?')
                    ->execute([$passwordHash, $encryptedPassword, $client['id']]);
            } else {
                $pdo->prepare("INSERT INTO client_portal_access (client_id, password_hash, admin_view_password_enc, status, portal_enabled, created_at)
                    VALUES (?, ?, ?, 'Active', 1, ?)")
                    ->execute([$client['id'], $passwordHash, $encryptedPassword, $now]);
            }
            $pdo->prepare('UPDATE clients SET updated_at = ? WHERE id = ?')->execute([$now, $client['id']]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        $clientId = (string)$client['id'];
        $accountCreated = false;
    }

    $auditId = 'aud_' . time() . '_' . substr(bin2hex(random_bytes(3)), 0, 4);
    $pdo->prepare("INSERT INTO audit_logs (id, user_id, action, details, created_at) VALUES (?, ?, 'PASSWORD_RESET', 'Admin updated client portal password', ?)")
        ->execute([$auditId, $clientId, $now]);

    jsonResponse([
        'ok' => true,
        'message' => 'Client portal password updated successfully.',
        'client_id' => $clientId,
        'client_account_created' => $accountCreated,
    ]);
}
