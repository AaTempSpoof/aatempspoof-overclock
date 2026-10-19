# KO侧载超频服务网站

这是 KO侧载超频的公开静态站点，只包含用户需要访问的网页、收款码、公开入口配置、公开清单和主模块下载包。独立 API 与手机通知服务运行在私有服务器和私有源码目录中，公开仓库不包含数据库、管理凭据、通知包、配对密钥或服务源码。

注册页使用服务端签发的 `issued`、`expires`、`nonce`、`order`、`sig` 参数。赞助页先确认邮箱，再进入独立订单队列；轮到订单后点击“开始付款”才显示微信/支付宝收款图和倒计时，超时可重新排队。付款成功后，API 通过独立 SMTP 配置自动发送一次性链接。状态查询只接受订单创建时返回的随机 `statusToken`，且只返回付款/邮件状态，不会泄露注册链接。

公开页面请求的接口：

- `POST /register/status`
- `POST /register/send-code`
- `POST /register/submit`
- `GET /donate/config`
- `POST /donate/start`
- `POST /donate/status`
- `POST /donate/begin`
- `POST /donate/requeue`
- `POST /donate/begin`
- `POST /donate/requeue`

`admin.html` 登录后通过内存中的 Bearer Token 访问管理 API。刷新页面会清除 Token。管理员可处理捐赠队列与注册链接重发、审批设备、分别配置微信/支付宝收款图与 SMTP，并导入导出由服务端重新签名的名单文本。

本机 `http://127.0.0.1:28089/admin.html` 是管理员使用的管理页面；公网入口只通过独立 HTTPS API 工作。通知模块、配对密钥和运行配置由管理员私下配置，不作为公开下载内容。

静态网站仓库禁止放入数据库、运行目录、名单原件、SMTP 密码、签名私钥、管理员 Token、手机通知模块或真实支付回调密钥。公开 `cloud.txt` 只保存当前 API 入口；服务端使用 `AAT_OC_ALLOWED_ORIGINS` 限定允许来源。

## 模块下载

KO侧载超频 1.0.2 构建后记录实际 ZIP 大小和 SHA-256。

- [KO侧载超频 1.0.2](KO侧载超频_1.0.2.zip)
