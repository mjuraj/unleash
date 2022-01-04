import crypto from 'crypto';
import { Logger } from '../logger';
import { ADMIN, CLIENT } from '../types/permissions';
import { IUnleashStores } from '../types/stores';
import { IUnleashConfig } from '../types/option';
import ApiUser from '../types/api-user';
import {
    ALL,
    ApiTokenType,
    IApiToken,
    IApiTokenCreate,
} from '../types/models/api-token';
import { IApiTokenStore } from '../types/stores/api-token-store';
import { FOREIGN_KEY_VIOLATION } from '../error/db-error';
import BadDataError from '../error/bad-data-error';
import { minutesToMilliseconds } from 'date-fns';

export class ApiTokenService {
    private store: IApiTokenStore;

    private logger: Logger;

    private timer: NodeJS.Timeout;

    private activeTokens: IApiToken[] = [];

    constructor(
        { apiTokenStore }: Pick<IUnleashStores, 'apiTokenStore'>,
        config: Pick<IUnleashConfig, 'getLogger' | 'authentication'>,
    ) {
        this.store = apiTokenStore;
        this.logger = config.getLogger('/services/api-token-service.ts');
        this.fetchActiveTokens();
        this.timer = setInterval(
            () => this.fetchActiveTokens(),
            minutesToMilliseconds(1),
        ).unref();
        if (config.authentication && config.authentication.initApiTokens) {
            process.nextTick(() =>
                this.initApiTokens(config.authentication.initApiTokens),
            );
        }
    }

    private async fetchActiveTokens(): Promise<void> {
        try {
            this.activeTokens = await this.getAllActiveTokens();
        } finally {
            // eslint-disable-next-line no-unsafe-finally
            return;
        }
    }

    public async getAllTokens(): Promise<IApiToken[]> {
        return this.store.getAll();
    }

    public async getAllActiveTokens(): Promise<IApiToken[]> {
        return this.store.getAllActive();
    }

    private async initApiTokens(tokens: string[]) {
        const tokenCount = await this.store.count();
        if (tokenCount) {
            return;
        }
        try {
            for (const token of tokens) {
                const tokenParts = token.split(':');
                const newToken: IApiToken = {
                    createdAt: undefined,
                    project: tokenParts[0],
                    environment: tokenParts[1],
                    secret: `${tokenParts[0]}:${tokenParts[1]}.${tokenParts[2]}`,
                    type: ApiTokenType.ADMIN,
                    username: 'admin',
                };
                this.validateNewApiToken(newToken);
                await this.insertNewApiToken(newToken);
            }
        } catch (e) {
            this.logger.error('Unable to create initial Admin API tokens');
        }
    }

    public getUserForToken(secret: string): ApiUser | undefined {
        const token = this.activeTokens.find((t) => t.secret === secret);
        if (token) {
            const permissions =
                token.type === ApiTokenType.ADMIN ? [ADMIN] : [CLIENT];

            return new ApiUser({
                username: token.username,
                permissions,
                project: token.project,
                environment: token.environment,
                type: token.type,
            });
        }
        return undefined;
    }

    public async updateExpiry(
        secret: string,
        expiresAt: Date,
    ): Promise<IApiToken> {
        return this.store.setExpiry(secret, expiresAt);
    }

    public async delete(secret: string): Promise<void> {
        return this.store.delete(secret);
    }

    private validateNewApiToken({ type, project, environment }) {
        if (type === ApiTokenType.ADMIN && project !== ALL) {
            throw new BadDataError(
                'Admin token cannot be scoped to single project',
            );
        }

        if (type === ApiTokenType.ADMIN && environment !== ALL) {
            throw new BadDataError(
                'Admin token cannot be scoped to single environment',
            );
        }

        if (type === ApiTokenType.CLIENT && environment === ALL) {
            throw new BadDataError(
                'Client token cannot be scoped to all environments',
            );
        }
    }

    public async createApiToken(
        newToken: Omit<IApiTokenCreate, 'secret'>,
    ): Promise<IApiToken> {
        this.validateNewApiToken(newToken);

        const secret = this.generateSecretKey(newToken);
        const createNewToken = { ...newToken, secret };
        return this.insertNewApiToken(createNewToken);
    }

    private async insertNewApiToken(
        newApiToken: IApiTokenCreate,
    ): Promise<IApiToken> {
        try {
            const token = await this.store.insert(newApiToken);
            this.activeTokens.push(token);
            return token;
        } catch (error) {
            if (error.code === FOREIGN_KEY_VIOLATION) {
                let { message } = error;
                if (error.constraint === 'api_tokens_project_fkey') {
                    message = `Project=${newApiToken.project} does not exist`;
                } else if (error.constraint === 'api_tokens_environment_fkey') {
                    message = `Environment=${newApiToken.environment} does not exist`;
                }
                throw new BadDataError(message);
            }
            throw error;
        }
    }

    private generateSecretKey({ project, environment }) {
        const randomStr = crypto.randomBytes(28).toString('hex');
        return `${project}:${environment}.${randomStr}`;
    }

    destroy(): void {
        clearInterval(this.timer);
        this.timer = null;
    }
}
