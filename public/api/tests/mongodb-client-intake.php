<?php
declare(strict_types=1);

final class IntakeResponse extends RuntimeException
{
    public function __construct(
        public readonly array $payload,
        public readonly int $status,
    ) {
        parent::__construct('Route response captured.');
    }
}

$mongoRows = [];
$mongoOperations = [];
$pdo = null;

function isMongoStorageEnabled(): bool
{
    return true;
}

function mongoFindOne(string $table, array $filter): ?array
{
    foreach ($GLOBALS['mongoRows'][$table] ?? [] as $row) {
        $matches = true;
        foreach ($filter as $field => $value) {
            if (($row[$field] ?? null) !== $value) {
                $matches = false;
                break;
            }
        }
        if ($matches) {
            return $row;
        }
    }
    return null;
}

function mongoInsert(string $table, array $document): void
{
    $GLOBALS['mongoOperations'][] = [$table, $document];
    $GLOBALS['mongoRows'][$table][] = $document;
}

function jsonResponse(mixed $data, int $status = 200): void
{
    throw new IntakeResponse($data, $status);
}

function expectIntake(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function dispatchIntake(string $path, string $routeMethod, array $routeInput): IntakeResponse
{
    global $apiPath, $method, $input, $pdo;
    $apiPath = $path;
    $method = $routeMethod;
    $input = $routeInput;
    $pdo = null;
    $_SERVER['REMOTE_ADDR'] = '192.0.2.10';

    try {
        require dirname(__DIR__) . '/routes/02-client-intake.php';
    } catch (IntakeResponse $response) {
        return $response;
    }

    throw new RuntimeException('The route did not return a response.');
}

$invalid = dispatchIntake('/newsletter/subscribers', 'POST', ['email' => 'invalid']);
expectIntake($invalid->status === 422, 'Invalid newsletter email must retain the 422 response.');
expectIntake($GLOBALS['mongoOperations'] === [], 'Invalid newsletter input must not write data.');

$created = dispatchIntake('/newsletter/subscribers', 'POST', [
    'email' => '  Jane+News@example.com ',
    'source' => '  campaign  ',
]);
expectIntake($created->status === 201, 'A new subscriber must retain the 201 response.');
expectIntake($created->payload['alreadySubscribed'] === false, 'New subscribers must be reported as new.');
$subscriber = $GLOBALS['mongoRows']['newsletter_subscribers'][0] ?? [];
expectIntake($subscriber['email'] === 'jane+news@example.com', 'Subscriber email must be normalized.');
expectIntake($subscriber['source'] === 'campaign', 'Subscriber source must be trimmed.');
expectIntake(isset($subscriber['id'], $subscriber['subscribed_at']), 'Subscriber SQL fields must be preserved.');

$duplicate = dispatchIntake('/newsletter/subscribers', 'POST', ['email' => 'JANE+NEWS@example.com']);
expectIntake($duplicate->status === 200, 'Existing subscribers must retain the 200 response.');
expectIntake($duplicate->payload['alreadySubscribed'] === true, 'Existing subscribers must be reported as duplicates.');
expectIntake(count($GLOBALS['mongoOperations']) === 1, 'Duplicate subscription must not insert another document.');

$contact = dispatchIntake('/crm/clients', 'POST', [
    'firstName' => 'Alex',
    'lastName' => 'Rivera',
    'email' => ' ALEX@example.com ',
    'service' => 'Consulting',
]);
expectIntake($contact->status === 200, 'Contact intake must retain the existing 200 response.');
expectIntake($contact->payload['message'] === 'Thank you! Your inquiry has been received.', 'Contact response message changed.');
expectIntake(count($GLOBALS['mongoRows']['clients']) === 1, 'Contact intake must persist the client row.');
expectIntake(count($GLOBALS['mongoRows']['audit_logs']) === 1, 'Contact intake must persist its audit row.');
expectIntake($GLOBALS['mongoRows']['clients'][0]['name'] === 'Alex Rivera', 'Contact name composition changed.');
expectIntake($GLOBALS['mongoRows']['clients'][0]['email'] === 'alex@example.com', 'Contact email normalization changed.');
expectIntake($GLOBALS['mongoRows']['audit_logs'][0]['action'] === 'CLIENT_INQUIRY', 'Contact audit action changed.');
expectIntake($GLOBALS['mongoRows']['audit_logs'][0]['ip_address'] === '192.0.2.10', 'Contact audit IP was not retained.');

$wrongMethod = dispatchIntake('/crm/clients', 'GET', []);
expectIntake($wrongMethod->status === 405, 'Unsupported contact-intake methods must not fall through to PDO.');
$unmigrated = dispatchIntake('/portal/signup/complete', 'POST', []);
expectIntake($unmigrated->status === 422, 'Portal signup completion must preserve SQL validation before the transaction guard.');
$variant = dispatchIntake('/crm/clients/unhandled', 'GET', []);
expectIntake($variant->status === 501, 'Unmatched client-intake route variants must not fall through to PDO.');

fwrite(STDOUT, "MongoDB client-intake route validation passed.\n");
