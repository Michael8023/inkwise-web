# 获取用户信息（余额

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/user/self:
    get:
      summary: 获取用户信息（余额
      deprecated: false
      description: |-
        token 需要在 个人中心生成 系统令牌 进行调用
        非令牌页的API令牌
      tags:
        - 平台API
      parameters:
        - name: New-API-User
          in: header
          description: 在个人中心查看
          required: true
          example: '{{用户ID}}'
          schema:
            type: string
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apifox-orders: []
          headers: {}
          x-apifox-name: 成功
      security:
        - bearer: []
      x-apifox-folder: 平台API
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-225483899-run
components:
  schemas: {}
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
servers: []
security: []

```