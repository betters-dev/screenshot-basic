do
    local results = {}
    local correlationId = 0
    local DEFAULT_NUI_CALLBACK_URL = 'http://screenshot-basic/screenshot_created'

    local DEFAULT_OPTIONS = {
        encoding = 'jpg',
        quality = 0.92,
        headers = {}
    }

    local function registerCorrelation(cb)
        local id = tostring(correlationId)

        results[id] = cb

        correlationId = correlationId + 1

        return id
    end

    RegisterNuiCallback('screenshot_created', function(body, cb)
        cb(true)
        local id = tostring(body.id)

        if id ~= nil and results[id] then
            results[id](body.data)
            results[id] = nil
        end
    end)

    exports('requestScreenshot', function(options, cb)
        local realOptions = (type(options) == 'table') and options or {}
        local realCb = (type(options) == 'function') and options or cb

        if type(realOptions) == 'table' and not pcall(function() return realOptions.dummy end) then
            realCb = realOptions
            realOptions = {}
        end

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
    end)

    exports('requestScreenshotUpload', function(url, field, options, cb)
        local realOptions = (type(options) == 'table') and options or {}
        local realCb = (type(options) == 'function') and options or cb

        if type(realOptions) == 'table' and not pcall(function() return realOptions.dummy end) then
            realCb = realOptions
            realOptions = {}
        end

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
    end)
end
