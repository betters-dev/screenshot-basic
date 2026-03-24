do
    local results = {}
    local correlationId = 0
    local DEFAULT_NUI_CALLBACK_URL <const> = 'http://screenshot-basic/screenshot_created'

    local DEFAULT_OPTIONS <const> = {
        encoding = 'jpg',
        quality = 0.92,
        headers = {}
    }

    local function prepareRequest(options, cb)
        local realOptions = (type(options) == 'table') and options or {}
        local realCb = (type(options) == 'function') and options or cb
        local finalOptions = {
            encoding = realOptions.encoding or DEFAULT_OPTIONS.encoding,
            quality  = realOptions.quality or DEFAULT_OPTIONS.quality,
            headers  = realOptions.headers or DEFAULT_OPTIONS.headers,
            fields   = realOptions.fields or {},
        }

        for k, v in pairs(realOptions) do
            if finalOptions[k] == nil then finalOptions[k] = v end
        end
        local id = correlationId
        results[id] = realCb
        correlationId = id + 1

        finalOptions.correlation = id
        return finalOptions, realCb
    end

    exports('requestScreenshot', function(options, cb)
        local req = type(options) == 'table' and options['__cfx_functionReference'] and prepareRequest({}, options) or prepareRequest(options, cb)

        req.resultURL = nil
        req.targetField = nil
        req.targetURL = DEFAULT_NUI_CALLBACK_URL

        SendNUIMessage({ request = req })
    end)

    exports('requestScreenshotUpload', function(url, field, options, cb)
        local req = type(options) == 'table' and options['__cfx_functionReference'] and prepareRequest({}, options) or prepareRequest(options, cb)

        req.targetURL = url
        req.targetField = field
        req.resultURL = DEFAULT_NUI_CALLBACK_URL

        SendNUIMessage({ request = req })
    end)

    exports('requestRecordVideoUpload', function(url, field, options, cb)
        local req = type(options) == 'table' and options['__cfx_functionReference'] and prepareRequest({}, options) or prepareRequest(options, cb)

        req.targetURL = url
        req.targetField = field
        req.resultURL = DEFAULT_NUI_CALLBACK_URL
        req.recordVideo = true
        req.duration = req.duration or 5000

        SendNUIMessage({ request = req })
    end)

    RegisterNuiCallback('screenshot_created', function(body, cb)
        cb(true)
        local id = body.id
        local callback = results[id]

        if callback then
            callback(body.data)
            results[id] = nil
        end
    end)
end
