# KO侧载超频服务网站

此目录是独立静态网站，包含首页、设备登记、捐赠和管理页。独立 API 单独运行；本机守护器在公网健康检查通过后更新本地工作区的 `cloud.txt`，不会自动提交或推送。Quick Tunnel 地址变化时会更新本地文件；服务入口不可用时页面不会提交数据。

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

本机 `http://127.0.0.1:28089/admin.html` 会直接连接 `28088` 管理 API，不显示远程凭据登录。公网管理入口仍由独立远程凭据保护。管理页还包含手机通知日志、收款通知和通知设备在线状态；“复制手机配对密钥”用于给手机端超频通知签名配对，密钥需保存到 `/data/adb/aa-overclock-payment/overclock/phone-notification.key`。固定公网 API 入口配置完成前，公开 `cloud.txt` 保持空地址，手机不会尝试连接失效隧道。

静态网站仓库禁止放入数据库、运行目录、名单原件、SMTP 密码、签名私钥、管理员 Token 或真实支付回调密钥。公开 `cloud.txt` 只保存当前 API 入口；服务端使用 `AAT_OC_ALLOWED_ORIGINS` 限定允许来源。

## 模块下载

KO侧载超频 1.0.9 构建后记录实际 ZIP 大小和 SHA-256。

KO侧载超频双端通知 1.0.2 构建后记录实际 ZIP 大小和 SHA-256。

- [KO侧载超频 1.0.9](KO侧载超频_1.0.9.zip)
- [KO侧载超频双端通知 1.0.2](KO侧载超频双端收款通知_1.0.2.zip)

AaTempSpoof 统一超频 1.0.1：3,547,898 字节，SHA-256 `89998210b5ded0e972b602aaa2641fb13d55ad2e6fe751bb6b676d3c1044ba32`。

AaTempSpoof 超频双端通知 1.0.1：20,854 字节，SHA-256 `ddd0b5e65befd38055541455219e0a5a9bdb60f1a73b795530848d586cfcbff2`。
