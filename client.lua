do
    local results = {}
    local correlationId = 0
    local DEFAULT_NUI_CALLBACK_URL = 'http://screenshot-basic/screenshot_created'

    local DEFAULT_OPTIONS = {
        encoding = 'webp',
        quality = 0.92,
        headers = {}
    }

    local function registerCorrelation(cb)
        local id = tostring(correlationId)

        results[id] = cb

        correlationId = correlationId + 1

        return id
    end

    local function screenshotCreated(body, cb)
        cb(true)
        local id = tostring(body.id)

        if id ~= nil and results[id] then
            results[id](body.data)
            results[id] = nil
        end
    end

    local function requestScreenshot(options, cb)
        local realOptions = (type(options) == 'table') and options or {}
        local realCb = (type(options) == 'function') and options or cb

        for k, v in pairs(DEFAULT_OPTIONS) do
            if realOptions[k] == nil then
                realOptions[k] = v
            end
        end

        realOptions.resultURL = nil
        realOptions.targetField = nil
        realOptions.targetURL = DEFAULT_NUI_CALLBACK_URL

        realOptions.correlation = registerCorrelation(realCb)

        SendNUIMessage({
            request = realOptions
        })
    end

    local function requestScreenshotUpload(url, field, options, cb)
        local realOptions = (type(options) == 'table') and options or {}
        local realCb = (type(options) == 'function') and options or cb

        for k, v in pairs(DEFAULT_OPTIONS) do
            if realOptions[k] == nil then
                realOptions[k] = v
            end
        end

        realOptions.targetURL = url
        realOptions.targetField = field
        realOptions.resultURL = DEFAULT_NUI_CALLBACK_URL

        realOptions.correlation = registerCorrelation(realCb)

        SendNUIMessage({
            request = realOptions
        })
    end

    RegisterNuiCallback('screenshot_created', screenshotCreated)
    exports('requestScreenshot', requestScreenshot)
    exports('requestScreenshotUpload', requestScreenshotUpload)
end
