'use strict';

const should = require('should');
const {
    ERROR_FORMATS,
    ERROR_DEFAULTS,
    HTTP_STATUS_TITLES,
    ERROR_TYPE_URIS,
    DEFAULT_ERROR_CODES,
    ApiError,
    ErrorHandler,
    ErrorFactory,
    validateErrorConfig,
    getStatusTitle,
    createProblemDetails,
    createSimpleError,
    createLegacyError,
    createErrorResponse,
    parseErrorCodeMappings,
    fromError
} = require('../../lib/error-handler');

describe('Error Handler', function() {

    describe('Constants', function() {

        describe('ERROR_FORMATS', function() {
            it('should contain expected formats', function() {
                ERROR_FORMATS.should.containEql('rfc7807');
                ERROR_FORMATS.should.containEql('simple');
                ERROR_FORMATS.should.containEql('legacy');
            });
        });

        describe('ERROR_DEFAULTS', function() {
            it('should have expected default values', function() {
                ERROR_DEFAULTS.format.should.equal('rfc7807');
                ERROR_DEFAULTS.includeStackTrace.should.equal(false);
                ERROR_DEFAULTS.logErrors.should.equal(true);
                ERROR_DEFAULTS.defaultType.should.equal('about:blank');
            });
        });

        describe('HTTP_STATUS_TITLES', function() {
            it('should have common HTTP status codes', function() {
                HTTP_STATUS_TITLES[400].should.equal('Bad Request');
                HTTP_STATUS_TITLES[401].should.equal('Unauthorized');
                HTTP_STATUS_TITLES[403].should.equal('Forbidden');
                HTTP_STATUS_TITLES[404].should.equal('Not Found');
                HTTP_STATUS_TITLES[429].should.equal('Too Many Requests');
                HTTP_STATUS_TITLES[500].should.equal('Internal Server Error');
                HTTP_STATUS_TITLES[503].should.equal('Service Unavailable');
            });
        });

        describe('ERROR_TYPE_URIS', function() {
            it('should have common error type URIs', function() {
                ERROR_TYPE_URIS.validation.should.equal('urn:error:validation');
                ERROR_TYPE_URIS.authentication.should.equal('urn:error:authentication');
                ERROR_TYPE_URIS.authorization.should.equal('urn:error:authorization');
                ERROR_TYPE_URIS.notFound.should.equal('urn:error:not-found');
                ERROR_TYPE_URIS.rateLimit.should.equal('urn:error:rate-limit');
            });
        });

        describe('DEFAULT_ERROR_CODES', function() {
            it('should have validation error mapping', function() {
                DEFAULT_ERROR_CODES['VALIDATION_ERROR'].status.should.equal(400);
                DEFAULT_ERROR_CODES['VALIDATION_ERROR'].type.should.equal('urn:error:validation');
            });

            it('should have authentication error mapping', function() {
                DEFAULT_ERROR_CODES['AUTHENTICATION_REQUIRED'].status.should.equal(401);
                DEFAULT_ERROR_CODES['INVALID_TOKEN'].status.should.equal(401);
            });

            it('should have authorization error mapping', function() {
                DEFAULT_ERROR_CODES['FORBIDDEN'].status.should.equal(403);
                DEFAULT_ERROR_CODES['INSUFFICIENT_PERMISSIONS'].status.should.equal(403);
            });

            it('should have not found error mapping', function() {
                DEFAULT_ERROR_CODES['RESOURCE_NOT_FOUND'].status.should.equal(404);
            });

            it('should have rate limit error mapping', function() {
                DEFAULT_ERROR_CODES['RATE_LIMIT_EXCEEDED'].status.should.equal(429);
            });

            it('should have server error mapping', function() {
                DEFAULT_ERROR_CODES['INTERNAL_ERROR'].status.should.equal(500);
            });
        });
    });

    describe('validateErrorConfig', function() {

        it('should return valid for empty config', function() {
            const result = validateErrorConfig({});
            result.valid.should.equal(true);
            result.errors.should.have.length(0);
        });

        it('should return valid for valid config', function() {
            const result = validateErrorConfig({
                format: 'rfc7807',
                includeStackTrace: true,
                logErrors: false
            });
            result.valid.should.equal(true);
        });

        it('should reject invalid format', function() {
            const result = validateErrorConfig({ format: 'invalid' });
            result.valid.should.equal(false);
            result.errors[0].should.containEql('Invalid error format');
        });

        it('should reject non-boolean includeStackTrace', function() {
            const result = validateErrorConfig({ includeStackTrace: 'yes' });
            result.valid.should.equal(false);
            result.errors[0].should.containEql('includeStackTrace must be a boolean');
        });

        it('should reject non-boolean logErrors', function() {
            const result = validateErrorConfig({ logErrors: 'true' });
            result.valid.should.equal(false);
            result.errors[0].should.containEql('logErrors must be a boolean');
        });

        it('should validate customErrorCodes as object', function() {
            const result = validateErrorConfig({ customErrorCodes: 'not-object' });
            result.valid.should.equal(false);
            result.errors[0].should.containEql('customErrorCodes must be an object');
        });

        it('should validate customErrorCodes mapping format', function() {
            const result = validateErrorConfig({
                customErrorCodes: { 'MY_ERROR': 'not-object' }
            });
            result.valid.should.equal(false);
            result.errors[0].should.containEql('must have an object mapping');
        });

        it('should validate customErrorCodes status code', function() {
            const result = validateErrorConfig({
                customErrorCodes: { 'MY_ERROR': { status: 200 } }
            });
            result.valid.should.equal(false);
            result.errors[0].should.containEql('valid HTTP status code');
        });

        it('should accept valid customErrorCodes', function() {
            const result = validateErrorConfig({
                customErrorCodes: { 'MY_ERROR': { status: 422, title: 'My Error' } }
            });
            result.valid.should.equal(true);
        });
    });

    describe('getStatusTitle', function() {

        it('should return title for known status codes', function() {
            getStatusTitle(400).should.equal('Bad Request');
            getStatusTitle(401).should.equal('Unauthorized');
            getStatusTitle(404).should.equal('Not Found');
            getStatusTitle(500).should.equal('Internal Server Error');
        });

        it('should return generic title for unknown status codes', function() {
            getStatusTitle(599).should.equal('Error 599');
        });
    });

    describe('createProblemDetails', function() {

        it('should create RFC 7807 compliant object', function() {
            const problem = createProblemDetails({
                status: 400,
                type: 'urn:error:validation',
                title: 'Validation Error',
                detail: 'The request body is invalid'
            });

            problem.type.should.equal('urn:error:validation');
            problem.title.should.equal('Validation Error');
            problem.status.should.equal(400);
            problem.detail.should.equal('The request body is invalid');
        });

        it('should use default type when not provided', function() {
            const problem = createProblemDetails({ status: 400 });
            problem.type.should.equal('about:blank');
        });

        it('should use status title when title not provided', function() {
            const problem = createProblemDetails({ status: 404 });
            problem.title.should.equal('Not Found');
        });

        it('should include instance when provided', function() {
            const problem = createProblemDetails({
                status: 404,
                instance: '/api/users/123'
            });
            problem.instance.should.equal('/api/users/123');
        });

        it('should not include null detail or instance', function() {
            const problem = createProblemDetails({ status: 400 });
            should.not.exist(problem.detail);
            should.not.exist(problem.instance);
        });

        it('should include extensions', function() {
            const problem = createProblemDetails({
                status: 400,
                extensions: {
                    errors: [{ field: 'email', message: 'Invalid email' }],
                    timestamp: '2025-01-01T00:00:00Z'
                }
            });

            problem.errors.should.be.Array();
            problem.timestamp.should.equal('2025-01-01T00:00:00Z');
        });

        it('should not overwrite core properties with extensions', function() {
            const problem = createProblemDetails({
                status: 400,
                title: 'Original Title',
                extensions: { title: 'Hacked Title' }
            });

            problem.title.should.equal('Original Title');
        });

        it('should default status to 500', function() {
            const problem = createProblemDetails({});
            problem.status.should.equal(500);
        });
    });

    describe('createSimpleError', function() {

        it('should create simple error object', function() {
            const error = createSimpleError({
                status: 400,
                error: 'VALIDATION_ERROR',
                message: 'Invalid input'
            });

            error.statusCode.should.equal(400);
            error.error.should.equal('VALIDATION_ERROR');
            error.message.should.equal('Invalid input');
        });

        it('should use default values when not provided', function() {
            const error = createSimpleError({ status: 404 });
            error.error.should.equal('Not Found');
            error.message.should.equal('Not Found');
        });

        it('should include details when provided', function() {
            const error = createSimpleError({
                status: 400,
                details: { field: 'email' }
            });
            error.details.field.should.equal('email');
        });

        it('should not include details when not provided', function() {
            const error = createSimpleError({ status: 400 });
            should.not.exist(error.details);
        });
    });

    describe('createLegacyError', function() {

        it('should create legacy error format', function() {
            const error = createLegacyError({
                status: 400,
                code: 'VALIDATION_ERROR',
                message: 'Invalid input'
            });

            error.success.should.equal(false);
            error.error.code.should.equal('VALIDATION_ERROR');
            error.error.message.should.equal('Invalid input');
            error.error.status.should.equal(400);
        });

        it('should use status as code when not provided', function() {
            const error = createLegacyError({ status: 404 });
            error.error.code.should.equal('404');
        });

        it('should include data when provided', function() {
            const error = createLegacyError({
                status: 400,
                data: { field: 'email' }
            });
            error.error.data.field.should.equal('email');
        });
    });

    describe('createErrorResponse', function() {

        it('should create rfc7807 response by default', function() {
            const response = createErrorResponse({ status: 400 });
            response.type.should.exist;
            response.status.should.equal(400);
        });

        it('should create simple response', function() {
            const response = createErrorResponse({ status: 400 }, 'simple');
            response.statusCode.should.equal(400);
        });

        it('should create legacy response', function() {
            const response = createErrorResponse({ status: 400 }, 'legacy');
            response.success.should.equal(false);
        });
    });

    describe('parseErrorCodeMappings', function() {

        it('should return empty codes for null input', function() {
            const result = parseErrorCodeMappings(null);
            Object.keys(result.codes).should.have.length(0);
            result.errors.should.have.length(0);
        });

        it('should return empty codes for empty string', function() {
            const result = parseErrorCodeMappings('');
            Object.keys(result.codes).should.have.length(0);
        });

        it('should parse object input', function() {
            const result = parseErrorCodeMappings({
                'MY_ERROR': { status: 422, title: 'My Error' }
            });
            result.codes['MY_ERROR'].status.should.equal(422);
        });

        it('should parse JSON string input', function() {
            const result = parseErrorCodeMappings('{"MY_ERROR": {"status": 422}}');
            result.codes['MY_ERROR'].status.should.equal(422);
        });

        it('should report error for invalid JSON', function() {
            const result = parseErrorCodeMappings('not json');
            result.errors.length.should.be.above(0);
            result.errors[0].should.containEql('Invalid JSON');
        });

        it('should report error for array JSON', function() {
            const result = parseErrorCodeMappings('[]');
            result.errors[0].should.containEql('must be a JSON object');
        });

        it('should validate mapping format', function() {
            const result = parseErrorCodeMappings({ 'MY_ERROR': 'not-object' });
            result.errors[0].should.containEql('must have an object mapping');
        });

        it('should validate status codes', function() {
            const result = parseErrorCodeMappings({ 'MY_ERROR': { status: 200 } });
            result.errors[0].should.containEql('invalid status code');
        });
    });

    describe('ApiError', function() {

        it('should create error with code and message', function() {
            const error = new ApiError('VALIDATION_ERROR', 'Invalid input');
            error.code.should.equal('VALIDATION_ERROR');
            error.message.should.equal('Invalid input');
            error.name.should.equal('ApiError');
        });

        it('should use code as message when message not provided', function() {
            const error = new ApiError('INTERNAL_ERROR');
            error.message.should.equal('INTERNAL_ERROR');
        });

        it('should include timestamp', function() {
            const error = new ApiError('TEST', 'test');
            should.exist(error.timestamp);
        });

        it('should accept options', function() {
            const error = new ApiError('TEST', 'test', {
                status: 422,
                type: 'urn:error:custom',
                title: 'Custom Title',
                instance: '/api/test'
            });

            error.status.should.equal(422);
            error.type.should.equal('urn:error:custom');
            error.title.should.equal('Custom Title');
            error.instance.should.equal('/api/test');
        });

        it('should accept cause error', function() {
            const cause = new Error('Original error');
            const error = new ApiError('TEST', 'test', { cause });
            error.cause.should.equal(cause);
        });

        describe('toProblemDetails', function() {

            it('should convert to RFC 7807 format', function() {
                const error = new ApiError('VALIDATION_ERROR', 'Invalid input');
                const problem = error.toProblemDetails();

                problem.status.should.equal(400);
                problem.type.should.equal('urn:error:validation');
                problem.title.should.equal('Validation Error');
                problem.detail.should.equal('Invalid input');
                problem.code.should.equal('VALIDATION_ERROR');
            });

            it('should use custom error codes', function() {
                const error = new ApiError('MY_ERROR', 'Custom error');
                const customCodes = { 'MY_ERROR': { status: 422, title: 'My Title' } };
                const problem = error.toProblemDetails(customCodes);

                problem.status.should.equal(422);
                problem.title.should.equal('My Title');
            });

            it('should include stack when requested', function() {
                const error = new ApiError('TEST', 'test');
                const problem = error.toProblemDetails({}, true);
                problem.stack.should.be.Array();
            });

            it('should not include stack by default', function() {
                const error = new ApiError('TEST', 'test');
                const problem = error.toProblemDetails({}, false);
                should.not.exist(problem.stack);
            });

            it('should include extensions', function() {
                const error = new ApiError('TEST', 'test', {
                    extensions: { customField: 'value' }
                });
                const problem = error.toProblemDetails();
                problem.customField.should.equal('value');
            });
        });

        describe('toSimpleError', function() {

            it('should convert to simple error format', function() {
                const error = new ApiError('VALIDATION_ERROR', 'Invalid input');
                const simple = error.toSimpleError();

                simple.statusCode.should.equal(400);
                simple.error.should.equal('VALIDATION_ERROR');
                simple.message.should.equal('Invalid input');
            });
        });

        describe('getStatusCode', function() {

            it('should return status from options', function() {
                const error = new ApiError('TEST', 'test', { status: 422 });
                error.getStatusCode().should.equal(422);
            });

            it('should return status from default mapping', function() {
                const error = new ApiError('VALIDATION_ERROR', 'test');
                error.getStatusCode().should.equal(400);
            });

            it('should return 500 for unknown codes', function() {
                const error = new ApiError('UNKNOWN_CODE', 'test');
                error.getStatusCode().should.equal(500);
            });
        });
    });

    describe('fromError', function() {

        it('should return ApiError unchanged', function() {
            const original = new ApiError('TEST', 'test');
            const result = fromError(original);
            result.should.equal(original);
        });

        it('should convert standard Error', function() {
            const error = new Error('Something went wrong');
            const result = fromError(error);

            result.should.be.instanceOf(ApiError);
            result.code.should.equal('INTERNAL_ERROR');
            result.message.should.equal('Something went wrong');
            result.cause.should.equal(error);
        });

        it('should preserve error code from Error', function() {
            const error = new Error('Database connection failed');
            error.code = 'DATABASE_ERROR';
            const result = fromError(error);

            result.code.should.equal('DATABASE_ERROR');
        });

        it('should convert object to ApiError', function() {
            const obj = {
                code: 'CUSTOM_ERROR',
                message: 'Custom message',
                status: 422
            };
            const result = fromError(obj);

            result.code.should.equal('CUSTOM_ERROR');
            result.message.should.equal('Custom message');
            result.status.should.equal(422);
        });

        it('should convert string to ApiError', function() {
            const result = fromError('Something went wrong');

            result.should.be.instanceOf(ApiError);
            result.code.should.equal('INTERNAL_ERROR');
            result.message.should.equal('Something went wrong');
        });
    });

    describe('ErrorHandler', function() {

        describe('initialization', function() {

            it('should initialize with default values', function() {
                const handler = new ErrorHandler();
                handler.format.should.equal('rfc7807');
                handler.includeStackTrace.should.equal(false);
                handler.logErrors.should.equal(true);
            });

            it('should accept custom options', function() {
                const handler = new ErrorHandler({
                    format: 'simple',
                    includeStackTrace: true,
                    logErrors: false
                });

                handler.format.should.equal('simple');
                handler.includeStackTrace.should.equal(true);
                handler.logErrors.should.equal(false);
            });

            it('should merge custom error codes', function() {
                const handler = new ErrorHandler({
                    customErrorCodes: { 'MY_ERROR': { status: 422 } }
                });

                handler.customErrorCodes['MY_ERROR'].status.should.equal(422);
                handler.customErrorCodes['VALIDATION_ERROR'].should.exist;
            });

            it('should use default format for invalid format', function() {
                const handler = new ErrorHandler({ format: 'invalid' });
                handler.format.should.equal('rfc7807');
            });
        });

        describe('getConfig', function() {

            it('should return configuration', function() {
                const handler = new ErrorHandler();
                const config = handler.getConfig();

                config.format.should.equal('rfc7807');
                config.includeStackTrace.should.equal(false);
                config.logErrors.should.equal(true);
                config.customErrorCodes.should.be.Array();
            });
        });

        describe('handle', function() {

            it('should handle ApiError', function() {
                const handler = new ErrorHandler({ logErrors: false });
                const error = new ApiError('VALIDATION_ERROR', 'Invalid input');
                const result = handler.handle(error);

                result.statusCode.should.equal(400);
                result.body.type.should.equal('urn:error:validation');
                result.headers['Content-Type'].should.equal('application/problem+json');
            });

            it('should handle standard Error', function() {
                const handler = new ErrorHandler({ logErrors: false });
                const result = handler.handle(new Error('Something went wrong'));

                result.statusCode.should.equal(500);
                result.body.detail.should.equal('Something went wrong');
            });

            it('should handle string error', function() {
                const handler = new ErrorHandler({ logErrors: false });
                const result = handler.handle('Error message');

                result.statusCode.should.equal(500);
                result.body.detail.should.equal('Error message');
            });

            it('should use simple format', function() {
                const handler = new ErrorHandler({ format: 'simple', logErrors: false });
                const error = new ApiError('VALIDATION_ERROR', 'Invalid input');
                const result = handler.handle(error);

                result.body.statusCode.should.equal(400);
                result.body.error.should.equal('VALIDATION_ERROR');
                result.headers['Content-Type'].should.equal('application/json');
            });

            it('should use legacy format', function() {
                const handler = new ErrorHandler({ format: 'legacy', logErrors: false });
                const error = new ApiError('VALIDATION_ERROR', 'Invalid input');
                const result = handler.handle(error);

                result.body.success.should.equal(false);
                result.body.error.code.should.equal('VALIDATION_ERROR');
            });

            it('should include stack trace when enabled', function() {
                const handler = new ErrorHandler({
                    includeStackTrace: true,
                    logErrors: false
                });
                const error = new ApiError('TEST', 'test');
                const result = handler.handle(error);

                result.body.stack.should.be.Array();
            });

            it('should set instance from context', function() {
                const handler = new ErrorHandler({ logErrors: false });
                const error = new ApiError('TEST', 'test');
                const result = handler.handle(error, {
                    req: { originalUrl: '/api/users/123' }
                });

                result.body.instance.should.equal('/api/users/123');
            });

            it('should log errors when enabled', function() {
                let logged = false;
                const handler = new ErrorHandler({
                    logErrors: true,
                    logger: () => { logged = true; }
                });
                handler.handle(new ApiError('TEST', 'test'));
                logged.should.equal(true);
            });

            it('should not log errors when disabled', function() {
                let logged = false;
                const handler = new ErrorHandler({
                    logErrors: false,
                    logger: () => { logged = true; }
                });
                handler.handle(new ApiError('TEST', 'test'));
                logged.should.equal(false);
            });
        });

        describe('createError', function() {

            it('should create error response', function() {
                const handler = new ErrorHandler({ logErrors: false });
                const result = handler.createError('VALIDATION_ERROR', 'Invalid input');

                result.statusCode.should.equal(400);
                result.body.detail.should.equal('Invalid input');
            });

            it('should accept options', function() {
                const handler = new ErrorHandler({ logErrors: false });
                const result = handler.createError('TEST', 'Test', { status: 422 });

                result.statusCode.should.equal(422);
            });
        });

        describe('addErrorCode', function() {

            it('should add custom error code', function() {
                const handler = new ErrorHandler({ logErrors: false });
                handler.addErrorCode('CUSTOM_ERROR', { status: 418, title: 'Teapot' });

                const error = new ApiError('CUSTOM_ERROR', 'Test');
                const result = handler.handle(error);

                result.statusCode.should.equal(418);
                result.body.title.should.equal('Teapot');
            });
        });

        describe('getErrorMapping', function() {

            it('should return mapping for known code', function() {
                const handler = new ErrorHandler();
                const mapping = handler.getErrorMapping('VALIDATION_ERROR');
                mapping.status.should.equal(400);
            });

            it('should return null for unknown code', function() {
                const handler = new ErrorHandler();
                const mapping = handler.getErrorMapping('UNKNOWN_CODE');
                should.not.exist(mapping);
            });
        });
    });

    describe('ErrorFactory', function() {

        describe('validation', function() {
            it('should create validation error', function() {
                const error = ErrorFactory.validation('Invalid input', [
                    { field: 'email', message: 'Invalid email' }
                ]);

                error.code.should.equal('VALIDATION_ERROR');
                error.message.should.equal('Invalid input');
                error.extensions.errors.should.have.length(1);
            });
        });

        describe('authentication', function() {
            it('should create authentication error', function() {
                const error = ErrorFactory.authentication();
                error.code.should.equal('AUTHENTICATION_REQUIRED');
                error.message.should.equal('Authentication required');
            });

            it('should accept custom message', function() {
                const error = ErrorFactory.authentication('Invalid token');
                error.message.should.equal('Invalid token');
            });
        });

        describe('authorization', function() {
            it('should create authorization error', function() {
                const error = ErrorFactory.authorization('Access denied', ['admin']);

                error.code.should.equal('INSUFFICIENT_PERMISSIONS');
                error.message.should.equal('Access denied');
                error.extensions.missingScopes.should.containEql('admin');
            });
        });

        describe('notFound', function() {
            it('should create not found error', function() {
                const error = ErrorFactory.notFound('User', '123');

                error.code.should.equal('RESOURCE_NOT_FOUND');
                error.message.should.equal("User with ID '123' not found");
                error.extensions.resource.should.equal('User');
                error.extensions.id.should.equal('123');
            });

            it('should handle missing id', function() {
                const error = ErrorFactory.notFound('User');
                error.message.should.equal('User not found');
            });
        });

        describe('rateLimit', function() {
            it('should create rate limit error', function() {
                const error = ErrorFactory.rateLimit(60);

                error.code.should.equal('RATE_LIMIT_EXCEEDED');
                error.extensions.retryAfter.should.equal(60);
            });
        });

        describe('conflict', function() {
            it('should create conflict error', function() {
                const error = ErrorFactory.conflict('Duplicate email', 'user-456');

                error.code.should.equal('CONFLICT');
                error.extensions.conflictingId.should.equal('user-456');
            });
        });

        describe('internal', function() {
            it('should create internal error', function() {
                const cause = new Error('DB connection failed');
                const error = ErrorFactory.internal('Database error', cause);

                error.code.should.equal('INTERNAL_ERROR');
                error.cause.should.equal(cause);
            });
        });

        describe('serviceUnavailable', function() {
            it('should create service unavailable error', function() {
                const error = ErrorFactory.serviceUnavailable('Maintenance mode', 300);

                error.code.should.equal('SERVICE_UNAVAILABLE');
                error.extensions.retryAfter.should.equal(300);
            });
        });

        describe('badRequest', function() {
            it('should create bad request error', function() {
                const error = ErrorFactory.badRequest('Invalid JSON', { position: 42 });

                error.code.should.equal('INVALID_INPUT');
                error.extensions.position.should.equal(42);
            });
        });

        describe('methodNotAllowed', function() {
            it('should create method not allowed error', function() {
                const error = ErrorFactory.methodNotAllowed('DELETE', ['GET', 'POST']);

                error.code.should.equal('METHOD_NOT_ALLOWED');
                error.extensions.method.should.equal('DELETE');
                error.extensions.allowedMethods.should.containEql('GET');
            });
        });
    });
});
