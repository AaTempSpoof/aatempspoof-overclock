# 独立超频服务网站

此目录是独立静态网站，只包含首页、设备登记、捐赠和管理页。部署时在 `cloud.txt` 的 `api=` 后填写独立 API 的 HTTPS 根地址；API 与静态站点分开运行。服务未配置时页面不会提交数据。

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

`admin.html` 登录后通过内存中的 Bearer Token 访问管理 API。刷新页面会清除 Token。管理员可处理捐赠队列与注册链接重发、审批设备、更新捐赠/SMTP 配置，并导入导出由服务端重新签名的名单文本。

静态网站仓库禁止放入数据库、运行目录、名单原件、SMTP 密码、签名私钥、管理员 Token、真实支付回调密钥或临时公网地址。公开部署前只需配置 `cloud.txt` 的 API 地址；服务端使用 `AAT_OC_ALLOWED_ORIGINS` 限定允许来源。
