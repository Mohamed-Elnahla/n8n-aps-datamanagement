# Authentication and ACC provisioning

## Credential type

Create an n8n credential named **Autodesk APS 2-Legged OAuth Community API**.

Fields:

| Field | Required | Purpose |
| --- | --- | --- |
| Client ID | Yes | APS application client ID |
| Client Secret | Yes | APS application secret, stored as an encrypted n8n credential value |
| Act as User ID | No | Sends the ACC `x-user-id` header to restrict calls to a specific user context |

The node exchanges the client ID/secret for a short-lived client-credentials token when execution starts. Access tokens are not saved in workflow parameters or node output.

## OAuth scopes

Read operations request:

```text
data:read data:search
```

Upload operations request:

```text
data:read data:write data:create
```

Download uses read scopes. The direct signed transfer URL is requested using the same APS token and the binary is transferred directly from/to the signed storage URL.

## ACC access requirements

Possessing an APS client ID and secret is not enough to access an ACC account. The application must be provisioned as an integration for the target ACC account, and its service-account/user context must have access to the target project and Docs folders.

Before testing the credential, verify:

1. The APS application is active.
2. The integration is configured in the correct ACC account.
3. The integration has access to the intended ACC projects.
4. The service account or selected `x-user-id` user has the required folder permissions.
5. The entered client secret is current and has not been rotated or revoked.

## n8n secret handling

- Put the client secret only in an n8n credential field.
- Do not put it in a Set/Edit Fields node, Code node, workflow variable, URL, or committed environment file.
- Configure and protect `N8N_ENCRYPTION_KEY` according to n8n's self-hosting guidance.
- Restrict credential sharing inside n8n.
- Back up encrypted credential data and the corresponding encryption key through your approved process.

## Test credential behavior

The credential test requests a 2-legged token and calls **Get Hubs**. A successful result proves that the secret can obtain a token and the Data Management endpoint can be reached. It does not prove that every project or folder is accessible.

## Common errors

### 401 Unauthorized

- Check the client ID and secret.
- Confirm the secret has not expired or been rotated.
- Recreate the credential after rotating the secret.

### 403 Forbidden

- Confirm the app is provisioned in the ACC account.
- Confirm service-account/user permissions.
- If using **Act as User ID**, verify that user belongs to the account/project and has the required access.

### Empty hub list

The node filters hub results to IDs beginning with `b.` because it is intended for ACC/BIM 360-style account hubs. Confirm the integration is connected to at least one supported account.

### Empty project list

The project selector filters projects to `projectType: ACC`. Confirm the chosen hub contains ACC projects accessible to the integration.

### Upload permission error

The service account or selected user must be permitted to upload to the destination folder. Also select the appropriate **ACC File Type** for Project Files versus Plans.
