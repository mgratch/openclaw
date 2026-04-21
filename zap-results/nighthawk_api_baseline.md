# ZAP Scanning Report

ZAP by [Checkmarx](https://checkmarx.com/).


## Summary of Alerts

| Risk Level | Number of Alerts |
| --- | --- |
| High | 0 |
| Medium | 8 |
| Low | 10 |
| Informational | 8 |




## Insights

| Level | Reason | Site | Description | Statistic |
| --- | --- | --- | --- | --- |
| Low | Warning |  | ZAP warnings logged - see the zap.log file for details | 3    |
| Info | Informational | https://www.nighthawkpro.com | Percentage of responses with status code 2xx | 98 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of responses with status code 3xx | 1 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of responses with status code 4xx | 1 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of endpoints with content type application/json | 1 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of endpoints with content type application/rss+xml | 1 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of endpoints with content type application/xml | 2 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of endpoints with content type image/png | 14 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of endpoints with content type image/vnd.microsoft.icon | 1 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of endpoints with content type text/css | 8 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of endpoints with content type text/html | 58 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of endpoints with content type text/javascript | 11 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of endpoints with content type text/plain | 4 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of endpoints with content type text/xml | 1 % |
| Info | Informational | https://www.nighthawkpro.com | Percentage of endpoints with method GET | 99 % |
| Info | Informational | https://www.nighthawkpro.com | Count of total endpoints | 297    |
| Info | Informational | https://www.nighthawkpro.com | Percentage of slow responses | 99 % |




## Alerts

| Name | Risk Level | Number of Instances |
| --- | --- | --- |
| Absence of Anti-CSRF Tokens | Medium | Systemic |
| CSP: Failure to Define Directive with No Fallback | Medium | 3 |
| CSP: Wildcard Directive | Medium | 3 |
| CSP: script-src unsafe-inline | Medium | 3 |
| CSP: style-src unsafe-inline | Medium | 3 |
| Content Security Policy (CSP) Header Not Set | Medium | Systemic |
| Missing Anti-clickjacking Header | Medium | Systemic |
| Sub Resource Integrity Attribute Missing | Medium | Systemic |
| Cookie without SameSite Attribute | Low | 3 |
| Cross-Domain JavaScript Source File Inclusion | Low | Systemic |
| Cross-Origin-Embedder-Policy Header Missing or Invalid | Low | 3 |
| Cross-Origin-Opener-Policy Header Missing or Invalid | Low | 3 |
| Cross-Origin-Resource-Policy Header Missing or Invalid | Low | 4 |
| Permissions Policy Header Not Set | Low | Systemic |
| Server Leaks Version Information via "Server" HTTP Response Header Field | Low | Systemic |
| Strict-Transport-Security Header Not Set | Low | Systemic |
| Timestamp Disclosure - Unix | Low | 3 |
| X-Content-Type-Options Header Missing | Low | Systemic |
| Charset Mismatch | Informational | 1 |
| Information Disclosure - Suspicious Comments | Informational | 4 |
| Modern Web Application | Informational | Systemic |
| Non-Storable Content | Informational | 3 |
| Re-examine Cache-control Directives | Informational | Systemic |
| Session Management Response Identified | Informational | 3 |
| Storable and Cacheable Content | Informational | Systemic |
| User Controllable HTML Element Attribute (Potential XSS) | Informational | 5 |




## Alert Detail



### [ Absence of Anti-CSRF Tokens ](https://www.zaproxy.org/docs/alerts/10202/)



##### Medium (Low)

### Description

No Anti-CSRF tokens were found in a HTML submission form.
A cross-site request forgery is an attack that involves forcing a victim to send an HTTP request to a target destination without their knowledge or intent in order to perform an action as the victim. The underlying cause is application functionality using predictable URL/form actions in a repeatable way. The nature of the attack is that CSRF exploits the trust that a web site has for a user. By contrast, cross-site scripting (XSS) exploits the trust that a user has for a web site. Like XSS, CSRF attacks are not necessarily cross-site, but they can be. Cross-site request forgery is also known as CSRF, XSRF, one-click attack, session riding, confused deputy, and sea surf.

CSRF attacks are effective in a number of situations, including:
    * The victim has an active session on the target site.
    * The victim is authenticated via HTTP auth on the target site.
    * The victim is on the same local network as the target site.

CSRF has primarily been used to perform an action against a target site using the victim's privileges, but recent techniques have been discovered to disclose information by gaining access to the response. The risk of information disclosure is dramatically increased when the target site is vulnerable to XSS, because XSS can be used as a platform for CSRF, allowing the attack to operate within the bounds of the same-origin policy.

* URL: https://www.nighthawkpro.com/blog/
  * Node Name: `https://www.nighthawkpro.com/blog/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<form action="https://www.nighthawkpro.com/wp-comments-post.php" method="post" id="commentform" class="comment-form">`
  * Other Info: `No known Anti-CSRF token [anticsrf, CSRFToken, __RequestVerificationToken, csrfmiddlewaretoken, authenticity_token, OWASP_CSRFTOKEN, anoncsrf, csrf_token, _csrf, _csrfSecret, __csrf_magic, CSRF, _token, _csrf_token, _csrfToken] was found in the following HTML form: [Form 3: "author" "comment_parent" "comment_post_ID" "email" "submit" "url" "wp-comment-cookies-consent" ].`
* URL: https://www.nighthawkpro.com/contact/
  * Node Name: `https://www.nighthawkpro.com/contact/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<form action="/contact/#wpcf7-f7-p122-o1" method="post" class="wpcf7-form init" aria-label="Contact form" novalidate="novalidate" data-status="init">`
  * Other Info: `No known Anti-CSRF token [anticsrf, CSRFToken, __RequestVerificationToken, csrfmiddlewaretoken, authenticity_token, OWASP_CSRFTOKEN, anoncsrf, csrf_token, _csrf, _csrfSecret, __csrf_magic, CSRF, _token, _csrf_token, _csrfToken] was found in the following HTML form: [Form 1: "_wpcf7" "_wpcf7_container_post" "_wpcf7_locale" "_wpcf7_posted_data_hash" "_wpcf7_unit_tag" "_wpcf7_version" "Email" "Name" "Phone" ].`
* URL: https://www.nighthawkpro.com/wp-login.php%3Faction=lostpassword
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (action)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<form name="lostpasswordform" id="lostpasswordform" action="https://www.nighthawkpro.com/wp-login.php?action=lostpassword" method="post">`
  * Other Info: `No known Anti-CSRF token [anticsrf, CSRFToken, __RequestVerificationToken, csrfmiddlewaretoken, authenticity_token, OWASP_CSRFTOKEN, anoncsrf, csrf_token, _csrf, _csrfSecret, __csrf_magic, CSRF, _token, _csrf_token, _csrfToken] was found in the following HTML form: [Form 1: "redirect_to" "user_login" "wp-submit" ].`
* URL: https://www.nighthawkpro.com/wp-login.php%3Freauth=1&redirect_to=https%253A%252F%252Fwww.nighthawkpro.com%252Fwp-admin%252F
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (reauth,redirect_to)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<form name="loginform" id="loginform" action="https://www.nighthawkpro.com/wp-login.php" method="post">`
  * Other Info: `No known Anti-CSRF token [anticsrf, CSRFToken, __RequestVerificationToken, csrfmiddlewaretoken, authenticity_token, OWASP_CSRFTOKEN, anoncsrf, csrf_token, _csrf, _csrfSecret, __csrf_magic, CSRF, _token, _csrf_token, _csrfToken] was found in the following HTML form: [Form 1: "redirect_to" "rememberme" "testcookie" "user_login" "user_pass" "wp-submit" ].`
* URL: https://www.nighthawkpro.com/wp-login.php
  * Node Name: `https://www.nighthawkpro.com/wp-login.php ()(log,pwd,redirect_to,rememberme,testcookie,wp-submit)`
  * Method: `POST`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<form name="loginform" id="loginform" action="https://www.nighthawkpro.com/wp-login.php" method="post">`
  * Other Info: `No known Anti-CSRF token [anticsrf, CSRFToken, __RequestVerificationToken, csrfmiddlewaretoken, authenticity_token, OWASP_CSRFTOKEN, anoncsrf, csrf_token, _csrf, _csrfSecret, __csrf_magic, CSRF, _token, _csrf_token, _csrfToken] was found in the following HTML form: [Form 1: "redirect_to" "rememberme" "testcookie" "user_login" "user_pass" "wp-submit" ].`

Instances: Systemic


### Solution

Phase: Architecture and Design
Use a vetted library or framework that does not allow this weakness to occur or provides constructs that make this weakness easier to avoid.
For example, use anti-CSRF packages such as the OWASP CSRFGuard.

Phase: Implementation
Ensure that your application is free of cross-site scripting issues, because most CSRF defenses can be bypassed using attacker-controlled script.

Phase: Architecture and Design
Generate a unique nonce for each form, place the nonce into the form, and verify the nonce upon receipt of the form. Be sure that the nonce is not predictable (CWE-330).
Note that this can be bypassed using XSS.

Identify especially dangerous operations. When the user performs a dangerous operation, send a separate confirmation request to ensure that the user intended to perform that operation.
Note that this can be bypassed using XSS.

Use the ESAPI Session Management control.
This control includes a component for CSRF.

Do not use the GET method for any request that triggers a state change.

Phase: Implementation
Check the HTTP Referer header to see if the request originated from an expected page. This could break legitimate functionality, because users or proxies may have disabled sending the Referer for privacy reasons.

### Reference


* [ https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html ](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
* [ https://cwe.mitre.org/data/definitions/352.html ](https://cwe.mitre.org/data/definitions/352.html)


#### CWE Id: [ 352 ](https://cwe.mitre.org/data/definitions/352.html)


#### WASC Id: 9

#### Source ID: 3

### [ CSP: Failure to Define Directive with No Fallback ](https://www.zaproxy.org/docs/alerts/10055/)



##### Medium (High)

### Description

The Content Security Policy fails to define one of the directives that has no fallback. Missing/excluding them is the same as allowing anything.

* URL: https://www.nighthawkpro.com/wp-login.php%3Faction=lostpassword
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (action)`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `The directive(s): form-action is/are among the directives that do not fallback to default-src.`
* URL: https://www.nighthawkpro.com/wp-login.php%3Freauth=1&redirect_to=https%253A%252F%252Fwww.nighthawkpro.com%252Fwp-admin%252F
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (reauth,redirect_to)`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `The directive(s): form-action is/are among the directives that do not fallback to default-src.`
* URL: https://www.nighthawkpro.com/wp-login.php
  * Node Name: `https://www.nighthawkpro.com/wp-login.php ()(log,pwd,redirect_to,rememberme,testcookie,wp-submit)`
  * Method: `POST`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `The directive(s): form-action is/are among the directives that do not fallback to default-src.`


Instances: 3

### Solution

Ensure that your web server, application server, load balancer, etc. is properly configured to set the Content-Security-Policy header.

### Reference


* [ https://www.w3.org/TR/CSP/ ](https://www.w3.org/TR/CSP/)
* [ https://caniuse.com/#search=content+security+policy ](https://caniuse.com/#search=content+security+policy)
* [ https://content-security-policy.com/ ](https://content-security-policy.com/)
* [ https://github.com/HtmlUnit/htmlunit-csp ](https://github.com/HtmlUnit/htmlunit-csp)
* [ https://web.dev/articles/csp#resource-options ](https://web.dev/articles/csp#resource-options)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 15

#### Source ID: 3

### [ CSP: Wildcard Directive ](https://www.zaproxy.org/docs/alerts/10055/)



##### Medium (High)

### Description

Content Security Policy (CSP) is an added layer of security that helps to detect and mitigate certain types of attacks. Including (but not limited to) Cross Site Scripting (XSS), and data injection attacks. These attacks are used for everything from data theft to site defacement or distribution of malware. CSP provides a set of standard HTTP headers that allow website owners to declare approved sources of content that browsers should be allowed to load on that page — covered types are JavaScript, CSS, HTML frames, fonts, images and embeddable objects such as Java applets, ActiveX, audio and video files.

* URL: https://www.nighthawkpro.com/wp-login.php%3Faction=lostpassword
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (action)`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `The following directives either allow wildcard sources (or ancestors), are not defined, or are overly broadly defined:
script-src, style-src, img-src, connect-src, frame-src, font-src, media-src, object-src, manifest-src, worker-src`
* URL: https://www.nighthawkpro.com/wp-login.php%3Freauth=1&redirect_to=https%253A%252F%252Fwww.nighthawkpro.com%252Fwp-admin%252F
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (reauth,redirect_to)`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `The following directives either allow wildcard sources (or ancestors), are not defined, or are overly broadly defined:
script-src, style-src, img-src, connect-src, frame-src, font-src, media-src, object-src, manifest-src, worker-src`
* URL: https://www.nighthawkpro.com/wp-login.php
  * Node Name: `https://www.nighthawkpro.com/wp-login.php ()(log,pwd,redirect_to,rememberme,testcookie,wp-submit)`
  * Method: `POST`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `The following directives either allow wildcard sources (or ancestors), are not defined, or are overly broadly defined:
script-src, style-src, img-src, connect-src, frame-src, font-src, media-src, object-src, manifest-src, worker-src`


Instances: 3

### Solution

Ensure that your web server, application server, load balancer, etc. is properly configured to set the Content-Security-Policy header.

### Reference


* [ https://www.w3.org/TR/CSP/ ](https://www.w3.org/TR/CSP/)
* [ https://caniuse.com/#search=content+security+policy ](https://caniuse.com/#search=content+security+policy)
* [ https://content-security-policy.com/ ](https://content-security-policy.com/)
* [ https://github.com/HtmlUnit/htmlunit-csp ](https://github.com/HtmlUnit/htmlunit-csp)
* [ https://web.dev/articles/csp#resource-options ](https://web.dev/articles/csp#resource-options)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 15

#### Source ID: 3

### [ CSP: script-src unsafe-inline ](https://www.zaproxy.org/docs/alerts/10055/)



##### Medium (High)

### Description

Content Security Policy (CSP) is an added layer of security that helps to detect and mitigate certain types of attacks. Including (but not limited to) Cross Site Scripting (XSS), and data injection attacks. These attacks are used for everything from data theft to site defacement or distribution of malware. CSP provides a set of standard HTTP headers that allow website owners to declare approved sources of content that browsers should be allowed to load on that page — covered types are JavaScript, CSS, HTML frames, fonts, images and embeddable objects such as Java applets, ActiveX, audio and video files.

* URL: https://www.nighthawkpro.com/wp-login.php%3Faction=lostpassword
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (action)`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `script-src includes unsafe-inline.`
* URL: https://www.nighthawkpro.com/wp-login.php%3Freauth=1&redirect_to=https%253A%252F%252Fwww.nighthawkpro.com%252Fwp-admin%252F
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (reauth,redirect_to)`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `script-src includes unsafe-inline.`
* URL: https://www.nighthawkpro.com/wp-login.php
  * Node Name: `https://www.nighthawkpro.com/wp-login.php ()(log,pwd,redirect_to,rememberme,testcookie,wp-submit)`
  * Method: `POST`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `script-src includes unsafe-inline.`


Instances: 3

### Solution

Ensure that your web server, application server, load balancer, etc. is properly configured to set the Content-Security-Policy header.

### Reference


* [ https://www.w3.org/TR/CSP/ ](https://www.w3.org/TR/CSP/)
* [ https://caniuse.com/#search=content+security+policy ](https://caniuse.com/#search=content+security+policy)
* [ https://content-security-policy.com/ ](https://content-security-policy.com/)
* [ https://github.com/HtmlUnit/htmlunit-csp ](https://github.com/HtmlUnit/htmlunit-csp)
* [ https://web.dev/articles/csp#resource-options ](https://web.dev/articles/csp#resource-options)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 15

#### Source ID: 3

### [ CSP: style-src unsafe-inline ](https://www.zaproxy.org/docs/alerts/10055/)



##### Medium (High)

### Description

Content Security Policy (CSP) is an added layer of security that helps to detect and mitigate certain types of attacks. Including (but not limited to) Cross Site Scripting (XSS), and data injection attacks. These attacks are used for everything from data theft to site defacement or distribution of malware. CSP provides a set of standard HTTP headers that allow website owners to declare approved sources of content that browsers should be allowed to load on that page — covered types are JavaScript, CSS, HTML frames, fonts, images and embeddable objects such as Java applets, ActiveX, audio and video files.

* URL: https://www.nighthawkpro.com/wp-login.php%3Faction=lostpassword
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (action)`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `style-src includes unsafe-inline.`
* URL: https://www.nighthawkpro.com/wp-login.php%3Freauth=1&redirect_to=https%253A%252F%252Fwww.nighthawkpro.com%252Fwp-admin%252F
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (reauth,redirect_to)`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `style-src includes unsafe-inline.`
* URL: https://www.nighthawkpro.com/wp-login.php
  * Node Name: `https://www.nighthawkpro.com/wp-login.php ()(log,pwd,redirect_to,rememberme,testcookie,wp-submit)`
  * Method: `POST`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `frame-ancestors 'self';`
  * Other Info: `style-src includes unsafe-inline.`


Instances: 3

### Solution

Ensure that your web server, application server, load balancer, etc. is properly configured to set the Content-Security-Policy header.

### Reference


* [ https://www.w3.org/TR/CSP/ ](https://www.w3.org/TR/CSP/)
* [ https://caniuse.com/#search=content+security+policy ](https://caniuse.com/#search=content+security+policy)
* [ https://content-security-policy.com/ ](https://content-security-policy.com/)
* [ https://github.com/HtmlUnit/htmlunit-csp ](https://github.com/HtmlUnit/htmlunit-csp)
* [ https://web.dev/articles/csp#resource-options ](https://web.dev/articles/csp#resource-options)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 15

#### Source ID: 3

### [ Content Security Policy (CSP) Header Not Set ](https://www.zaproxy.org/docs/alerts/10038/)



##### Medium (High)

### Description

Content Security Policy (CSP) is an added layer of security that helps to detect and mitigate certain types of attacks, including Cross Site Scripting (XSS) and data injection attacks. These attacks are used for everything from data theft to site defacement or distribution of malware. CSP provides a set of standard HTTP headers that allow website owners to declare approved sources of content that browsers should be allowed to load on that page — covered types are JavaScript, CSS, HTML frames, fonts, images and embeddable objects such as Java applets, ActiveX, audio and video files.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/admin/login
  * Node Name: `https://www.nighthawkpro.com/admin/login`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/api
  * Node Name: `https://www.nighthawkpro.com/api`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/demo/
  * Node Name: `https://www.nighthawkpro.com/demo/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-admin/admin-ajax.php
  * Node Name: `https://www.nighthawkpro.com/wp-admin/admin-ajax.php`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``

Instances: Systemic


### Solution

Ensure that your web server, application server, load balancer, etc. is configured to set the Content-Security-Policy header.

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
* [ https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html ](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
* [ https://www.w3.org/TR/CSP/ ](https://www.w3.org/TR/CSP/)
* [ https://w3c.github.io/webappsec-csp/ ](https://w3c.github.io/webappsec-csp/)
* [ https://web.dev/articles/csp ](https://web.dev/articles/csp)
* [ https://caniuse.com/#feat=contentsecuritypolicy ](https://caniuse.com/#feat=contentsecuritypolicy)
* [ https://content-security-policy.com/ ](https://content-security-policy.com/)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 15

#### Source ID: 3

### [ Missing Anti-clickjacking Header ](https://www.zaproxy.org/docs/alerts/10020/)



##### Medium (Medium)

### Description

The response does not protect against 'ClickJacking' attacks. It should include either Content-Security-Policy with 'frame-ancestors' directive or X-Frame-Options.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: `x-frame-options`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/admin/login
  * Node Name: `https://www.nighthawkpro.com/admin/login`
  * Method: `GET`
  * Parameter: `x-frame-options`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/contact/
  * Node Name: `https://www.nighthawkpro.com/contact/`
  * Method: `GET`
  * Parameter: `x-frame-options`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/demo/
  * Node Name: `https://www.nighthawkpro.com/demo/`
  * Method: `GET`
  * Parameter: `x-frame-options`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/solutions/
  * Node Name: `https://www.nighthawkpro.com/solutions/`
  * Method: `GET`
  * Parameter: `x-frame-options`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``

Instances: Systemic


### Solution

Modern Web browsers support the Content-Security-Policy and X-Frame-Options HTTP headers. Ensure one of them is set on all web pages returned by your site/app.
If you expect the page to be framed only by pages on your server (e.g. it's part of a FRAMESET) then you'll want to use SAMEORIGIN, otherwise if you never expect the page to be framed, you should use DENY. Alternatively consider implementing Content Security Policy's "frame-ancestors" directive.

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options)


#### CWE Id: [ 1021 ](https://cwe.mitre.org/data/definitions/1021.html)


#### WASC Id: 15

#### Source ID: 3

### [ Sub Resource Integrity Attribute Missing ](https://www.zaproxy.org/docs/alerts/90003/)



##### Medium (High)

### Description

The integrity attribute is missing on a script or link tag served by an external server. The integrity tag prevents an attacker who have gained access to this server from injecting a malicious content.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<link rel='stylesheet' id='vc_google_fonts_abril_fatfaceregular-css' href='https://fonts.googleapis.com/css?family=Abril+Fatface%3Aregular&#038;ver=6.13.0' type='text/css' media='all' />`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script async src="https://www.googletagmanager.com/gtag/js?id=G-8XGFB6YX1P"></script>`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script type="text/javascript" src="https://www.insightful-7-corporation.com/js/803960.js" ></script>`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/contact/
  * Node Name: `https://www.nighthawkpro.com/contact/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script type="text/javascript" src="https://www.insightful-7-corporation.com/js/803960.js" ></script>`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/demo/
  * Node Name: `https://www.nighthawkpro.com/demo/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap" rel="stylesheet">`
  * Other Info: ``

Instances: Systemic


### Solution

Provide a valid integrity attribute to the tag.

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity ](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)


#### CWE Id: [ 345 ](https://cwe.mitre.org/data/definitions/345.html)


#### WASC Id: 15

#### Source ID: 3

### [ Cookie without SameSite Attribute ](https://www.zaproxy.org/docs/alerts/10054/)



##### Low (Medium)

### Description

A cookie has been set without the SameSite attribute, which means that the cookie can be sent as a result of a 'cross-site' request. The SameSite attribute is an effective counter measure to cross-site request forgery, cross-site script inclusion, and timing attacks.

* URL: https://www.nighthawkpro.com/wp-login.php%3Faction=lostpassword
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (action)`
  * Method: `GET`
  * Parameter: `wordpress_test_cookie`
  * Attack: ``
  * Evidence: `Set-Cookie: wordpress_test_cookie`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-login.php%3Freauth=1&redirect_to=https%253A%252F%252Fwww.nighthawkpro.com%252Fwp-admin%252F
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (reauth,redirect_to)`
  * Method: `GET`
  * Parameter: `wordpress_test_cookie`
  * Attack: ``
  * Evidence: `Set-Cookie: wordpress_test_cookie`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-login.php
  * Node Name: `https://www.nighthawkpro.com/wp-login.php ()(log,pwd,redirect_to,rememberme,testcookie,wp-submit)`
  * Method: `POST`
  * Parameter: `wordpress_test_cookie`
  * Attack: ``
  * Evidence: `Set-Cookie: wordpress_test_cookie`
  * Other Info: ``


Instances: 3

### Solution

Ensure that the SameSite attribute is set to either 'lax' or ideally 'strict' for all cookies.

### Reference


* [ https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-cookie-same-site ](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-cookie-same-site)


#### CWE Id: [ 1275 ](https://cwe.mitre.org/data/definitions/1275.html)


#### WASC Id: 13

#### Source ID: 3

### [ Cross-Domain JavaScript Source File Inclusion ](https://www.zaproxy.org/docs/alerts/10017/)



##### Low (Medium)

### Description

The page includes one or more script files from a third-party domain.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: `https://www.googletagmanager.com/gtag/js?id=G-8XGFB6YX1P`
  * Attack: ``
  * Evidence: `<script async src="https://www.googletagmanager.com/gtag/js?id=G-8XGFB6YX1P"></script>`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: `https://www.insightful-7-corporation.com/js/803960.js`
  * Attack: ``
  * Evidence: `<script type="text/javascript" src="https://www.insightful-7-corporation.com/js/803960.js" ></script>`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/about-us/
  * Node Name: `https://www.nighthawkpro.com/about-us/`
  * Method: `GET`
  * Parameter: `https://www.insightful-7-corporation.com/js/803960.js`
  * Attack: ``
  * Evidence: `<script type="text/javascript" src="https://www.insightful-7-corporation.com/js/803960.js" ></script>`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/contact/
  * Node Name: `https://www.nighthawkpro.com/contact/`
  * Method: `GET`
  * Parameter: `https://www.googletagmanager.com/gtag/js?id=G-8XGFB6YX1P`
  * Attack: ``
  * Evidence: `<script async src="https://www.googletagmanager.com/gtag/js?id=G-8XGFB6YX1P"></script>`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/contact/
  * Node Name: `https://www.nighthawkpro.com/contact/`
  * Method: `GET`
  * Parameter: `https://www.insightful-7-corporation.com/js/803960.js`
  * Attack: ``
  * Evidence: `<script type="text/javascript" src="https://www.insightful-7-corporation.com/js/803960.js" ></script>`
  * Other Info: ``

Instances: Systemic


### Solution

Ensure JavaScript source files are loaded from only trusted sources, and the sources can't be controlled by end users of the application.

### Reference



#### CWE Id: [ 829 ](https://cwe.mitre.org/data/definitions/829.html)


#### WASC Id: 15

#### Source ID: 3

### [ Cross-Origin-Embedder-Policy Header Missing or Invalid ](https://www.zaproxy.org/docs/alerts/90004/)



##### Low (Medium)

### Description

Cross-Origin-Embedder-Policy header is a response header that prevents a document from loading any cross-origin resources that don't explicitly grant the document permission (using CORP or CORS).

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-sitemap-index.xsl
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap-index.xsl`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-sitemap.xml
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap.xml`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``


Instances: 3

### Solution

Ensure that the application/web server sets the Cross-Origin-Embedder-Policy header appropriately, and that it sets the Cross-Origin-Embedder-Policy header to 'require-corp' for documents.
If possible, ensure that the end user uses a standards-compliant and modern web browser that supports the Cross-Origin-Embedder-Policy header (https://caniuse.com/mdn-http_headers_cross-origin-embedder-policy).

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 14

#### Source ID: 3

### [ Cross-Origin-Opener-Policy Header Missing or Invalid ](https://www.zaproxy.org/docs/alerts/90004/)



##### Low (Medium)

### Description

Cross-Origin-Opener-Policy header is a response header that allows a site to control if others included documents share the same browsing context. Sharing the same browsing context with untrusted documents might lead to data leak.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: `Cross-Origin-Opener-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-sitemap-index.xsl
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap-index.xsl`
  * Method: `GET`
  * Parameter: `Cross-Origin-Opener-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-sitemap.xml
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap.xml`
  * Method: `GET`
  * Parameter: `Cross-Origin-Opener-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``


Instances: 3

### Solution

Ensure that the application/web server sets the Cross-Origin-Opener-Policy header appropriately, and that it sets the Cross-Origin-Opener-Policy header to 'same-origin' for documents.
'same-origin-allow-popups' is considered as less secured and should be avoided.
If possible, ensure that the end user uses a standards-compliant and modern web browser that supports the Cross-Origin-Opener-Policy header (https://caniuse.com/mdn-http_headers_cross-origin-opener-policy).

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 14

#### Source ID: 3

### [ Cross-Origin-Resource-Policy Header Missing or Invalid ](https://www.zaproxy.org/docs/alerts/90004/)



##### Low (Medium)

### Description

Cross-Origin-Resource-Policy header is an opt-in header designed to counter side-channels attacks like Spectre. Resource should be specifically set as shareable amongst different origins.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/robots.txt
  * Node Name: `https://www.nighthawkpro.com/robots.txt`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-sitemap-index.xsl
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap-index.xsl`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-sitemap.xml
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap.xml`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``


Instances: 4

### Solution

Ensure that the application/web server sets the Cross-Origin-Resource-Policy header appropriately, and that it sets the Cross-Origin-Resource-Policy header to 'same-origin' for all web pages.
'same-site' is considered as less secured and should be avoided.
If resources must be shared, set the header to 'cross-origin'.
If possible, ensure that the end user uses a standards-compliant and modern web browser that supports the Cross-Origin-Resource-Policy header (https://caniuse.com/mdn-http_headers_cross-origin-resource-policy).

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 14

#### Source ID: 3

### [ Permissions Policy Header Not Set ](https://www.zaproxy.org/docs/alerts/10063/)



##### Low (Medium)

### Description

Permissions Policy Header is an added layer of security that helps to restrict from unauthorized access or usage of browser/client features by web resources. This policy ensures the user privacy by limiting or specifying the features of the browsers can be used by the web resources. Permissions Policy provides a set of standard HTTP headers that allow website owners to limit which features of browsers can be used by the page such as camera, microphone, location, full screen etc.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/api
  * Node Name: `https://www.nighthawkpro.com/api`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/demo/
  * Node Name: `https://www.nighthawkpro.com/demo/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-admin/admin-ajax.php
  * Node Name: `https://www.nighthawkpro.com/wp-admin/admin-ajax.php`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-login.php%3Freauth=1&redirect_to=https%253A%252F%252Fwww.nighthawkpro.com%252Fwp-admin%252F
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (reauth,redirect_to)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``

Instances: Systemic


### Solution

Ensure that your web server, application server, load balancer, etc. is configured to set the Permissions-Policy header.

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy)
* [ https://developer.chrome.com/blog/feature-policy/ ](https://developer.chrome.com/blog/feature-policy/)
* [ https://scotthelme.co.uk/a-new-security-header-feature-policy/ ](https://scotthelme.co.uk/a-new-security-header-feature-policy/)
* [ https://w3c.github.io/webappsec-feature-policy/ ](https://w3c.github.io/webappsec-feature-policy/)
* [ https://www.smashingmagazine.com/2018/12/feature-policy/ ](https://www.smashingmagazine.com/2018/12/feature-policy/)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 15

#### Source ID: 3

### [ Server Leaks Version Information via "Server" HTTP Response Header Field ](https://www.zaproxy.org/docs/alerts/10036/)



##### Low (High)

### Description

The web/application server is leaking version information via the "Server" HTTP response header. Access to such information may facilitate attackers identifying other vulnerabilities your web/application server is subject to.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `Apache/2.4.58 (Ubuntu)`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/api
  * Node Name: `https://www.nighthawkpro.com/api`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `Apache/2.4.58 (Ubuntu)`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/robots.txt
  * Node Name: `https://www.nighthawkpro.com/robots.txt`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `Apache/2.4.58 (Ubuntu)`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/sitemap.xml
  * Node Name: `https://www.nighthawkpro.com/sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `Apache/2.4.58 (Ubuntu)`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-admin/
  * Node Name: `https://www.nighthawkpro.com/wp-admin/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `Apache/2.4.58 (Ubuntu)`
  * Other Info: ``

Instances: Systemic


### Solution

Ensure that your web server, application server, load balancer, etc. is configured to suppress the "Server" header or provide generic details.

### Reference


* [ https://httpd.apache.org/docs/current/mod/core.html#servertokens ](https://httpd.apache.org/docs/current/mod/core.html#servertokens)
* [ https://learn.microsoft.com/en-us/previous-versions/msp-n-p/ff648552(v=pandp.10) ](https://learn.microsoft.com/en-us/previous-versions/msp-n-p/ff648552(v=pandp.10))
* [ https://www.troyhunt.com/shhh-dont-let-your-response-headers/ ](https://www.troyhunt.com/shhh-dont-let-your-response-headers/)


#### CWE Id: [ 497 ](https://cwe.mitre.org/data/definitions/497.html)


#### WASC Id: 13

#### Source ID: 3

### [ Strict-Transport-Security Header Not Set ](https://www.zaproxy.org/docs/alerts/10035/)



##### Low (High)

### Description

HTTP Strict Transport Security (HSTS) is a web security policy mechanism whereby a web server declares that complying user agents (such as a web browser) are to interact with it using only secure HTTPS connections (i.e. HTTP layered over TLS/SSL). HSTS is an IETF standards track protocol and is specified in RFC 6797.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/api
  * Node Name: `https://www.nighthawkpro.com/api`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/robots.txt
  * Node Name: `https://www.nighthawkpro.com/robots.txt`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-admin/admin-ajax.php
  * Node Name: `https://www.nighthawkpro.com/wp-admin/admin-ajax.php`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-sitemap.xml
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``

Instances: Systemic


### Solution

Ensure that your web server, application server, load balancer, etc. is configured to enforce Strict-Transport-Security.

### Reference


* [ https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html ](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html)
* [ https://owasp.org/www-community/Security_Headers ](https://owasp.org/www-community/Security_Headers)
* [ https://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security ](https://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security)
* [ https://caniuse.com/stricttransportsecurity ](https://caniuse.com/stricttransportsecurity)
* [ https://datatracker.ietf.org/doc/html/rfc6797 ](https://datatracker.ietf.org/doc/html/rfc6797)


#### CWE Id: [ 319 ](https://cwe.mitre.org/data/definitions/319.html)


#### WASC Id: 15

#### Source ID: 3

### [ Timestamp Disclosure - Unix ](https://www.zaproxy.org/docs/alerts/10096/)



##### Low (Low)

### Description

A timestamp was disclosed by the application/web server. - Unix

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1999999999`
  * Other Info: `1999999999, which evaluates to: 2033-05-18 03:33:19.`
* URL: https://www.nighthawkpro.com/wp-content/plugins/html5-video-player/dist/frontend.css%3Fver=2.5.38
  * Node Name: `https://www.nighthawkpro.com/wp-content/plugins/html5-video-player/dist/frontend.css (ver)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1490196078`
  * Other Info: `1490196078, which evaluates to: 2017-03-22 15:21:18.`
* URL: https://www.nighthawkpro.com/wp-content/plugins/popup-maker/assets/css/pum-site.min.css%3Fver=1.20.5
  * Node Name: `https://www.nighthawkpro.com/wp-content/plugins/popup-maker/assets/css/pum-site.min.css (ver)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1999999999`
  * Other Info: `1999999999, which evaluates to: 2033-05-18 03:33:19.`


Instances: 3

### Solution

Manually confirm that the timestamp data is not sensitive, and that the data cannot be aggregated to disclose exploitable patterns.

### Reference


* [ https://cwe.mitre.org/data/definitions/200.html ](https://cwe.mitre.org/data/definitions/200.html)


#### CWE Id: [ 497 ](https://cwe.mitre.org/data/definitions/497.html)


#### WASC Id: 13

#### Source ID: 3

### [ X-Content-Type-Options Header Missing ](https://www.zaproxy.org/docs/alerts/10021/)



##### Low (Medium)

### Description

The Anti-MIME-Sniffing header X-Content-Type-Options was not set to 'nosniff'. This allows older versions of Internet Explorer and Chrome to perform MIME-sniffing on the response body, potentially causing the response body to be interpreted and displayed as a content type other than the declared content type. Current (early 2014) and legacy versions of Firefox will use the declared content type (if one is set), rather than performing MIME-sniffing.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: `x-content-type-options`
  * Attack: ``
  * Evidence: ``
  * Other Info: `This issue still applies to error type pages (401, 403, 500, etc.) as those pages are often still affected by injection issues, in which case there is still concern for browsers sniffing pages away from their actual content type.
At "High" threshold this scan rule will not alert on client or server error responses.`
* URL: https://www.nighthawkpro.com/robots.txt
  * Node Name: `https://www.nighthawkpro.com/robots.txt`
  * Method: `GET`
  * Parameter: `x-content-type-options`
  * Attack: ``
  * Evidence: ``
  * Other Info: `This issue still applies to error type pages (401, 403, 500, etc.) as those pages are often still affected by injection issues, in which case there is still concern for browsers sniffing pages away from their actual content type.
At "High" threshold this scan rule will not alert on client or server error responses.`
* URL: https://www.nighthawkpro.com/wp-content/plugins/html5-video-player/public/css/h5vp.css%3Fver=2.5.38
  * Node Name: `https://www.nighthawkpro.com/wp-content/plugins/html5-video-player/public/css/h5vp.css (ver)`
  * Method: `GET`
  * Parameter: `x-content-type-options`
  * Attack: ``
  * Evidence: ``
  * Other Info: `This issue still applies to error type pages (401, 403, 500, etc.) as those pages are often still affected by injection issues, in which case there is still concern for browsers sniffing pages away from their actual content type.
At "High" threshold this scan rule will not alert on client or server error responses.`
* URL: https://www.nighthawkpro.com/wp-sitemap-index.xsl
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap-index.xsl`
  * Method: `GET`
  * Parameter: `x-content-type-options`
  * Attack: ``
  * Evidence: ``
  * Other Info: `This issue still applies to error type pages (401, 403, 500, etc.) as those pages are often still affected by injection issues, in which case there is still concern for browsers sniffing pages away from their actual content type.
At "High" threshold this scan rule will not alert on client or server error responses.`
* URL: https://www.nighthawkpro.com/wp-sitemap.xml
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap.xml`
  * Method: `GET`
  * Parameter: `x-content-type-options`
  * Attack: ``
  * Evidence: ``
  * Other Info: `This issue still applies to error type pages (401, 403, 500, etc.) as those pages are often still affected by injection issues, in which case there is still concern for browsers sniffing pages away from their actual content type.
At "High" threshold this scan rule will not alert on client or server error responses.`

Instances: Systemic


### Solution

Ensure that the application/web server sets the Content-Type header appropriately, and that it sets the X-Content-Type-Options header to 'nosniff' for all web pages.
If possible, ensure that the end user uses a standards-compliant and modern web browser that does not perform MIME-sniffing at all, or that can be directed by the web application/web server to not perform MIME-sniffing.

### Reference


* [ https://learn.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/compatibility/gg622941(v=vs.85) ](https://learn.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/compatibility/gg622941(v=vs.85))
* [ https://owasp.org/www-community/Security_Headers ](https://owasp.org/www-community/Security_Headers)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 15

#### Source ID: 3

### [ Charset Mismatch ](https://www.zaproxy.org/docs/alerts/90011/)



##### Informational (Low)

### Description

This check identifies responses where the HTTP Content-Type header declares a charset different from the charset defined by the body of the HTML or XML. When there's a charset mismatch between the HTTP header and content body Web browsers can be forced into an undesirable content-sniffing mode to determine the content's correct character set.

An attacker could manipulate content on the page to be interpreted in an encoding of their choice. For example, if an attacker can control content at the beginning of the page, they could inject script using UTF-7 encoded text and manipulate some browsers into interpreting that text.

* URL: https://www.nighthawkpro.com/wp-json/oembed/1.0/embed%3Fformat=xml&url=https%253A%252F%252Fwww.nighthawkpro.com%252F
  * Node Name: `https://www.nighthawkpro.com/wp-json/oembed/1.0/embed (format,url)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `There was a charset mismatch between the HTTP Header and the XML encoding declaration: [UTF-8] and [null] do not match.`


Instances: 1

### Solution

Force UTF-8 for all text content in both the HTTP header and meta tags in HTML or encoding declarations in XML.

### Reference


* [ https://code.google.com/archive/p/browsersec/wikis/Part2.wiki#Character_set_handling_and_detection ](https://code.google.com/archive/p/browsersec/wikis/Part2.wiki#Character_set_handling_and_detection)


#### CWE Id: [ 436 ](https://cwe.mitre.org/data/definitions/436.html)


#### WASC Id: 15

#### Source ID: 3

### [ Information Disclosure - Suspicious Comments ](https://www.zaproxy.org/docs/alerts/10027/)



##### Informational (Medium)

### Description

The response appears to contain suspicious comments which may help an attacker.

* URL: https://www.nighthawkpro.com/wp-content/themes/creamery-lite/js/jquery.nivo.slider.js%3Fver=6.9.3
  * Node Name: `https://www.nighthawkpro.com/wp-content/themes/creamery-lite/js/jquery.nivo.slider.js (ver)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `/ Remove any slices from last transition`
  * Other Info: `The following pattern was used: \bFROM\b and was detected 3 times, the first in likely comment: "// Remove any slices from last transition", see evidence field for the suspicious comment/snippet.`
* URL: https://www.nighthawkpro.com/wp-content/themes/creamery-lite/js/jquery.nivo.slider.js%3Fver=6.9.3
  * Node Name: `https://www.nighthawkpro.com/wp-content/themes/creamery-lite/js/jquery.nivo.slider.js (ver)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `ue to some weird JS bug with loop vars 
  `
  * Other Info: `The following pattern was used: \bBUG\b and was detected in likely comment: "/* Due to some weird JS bug with loop vars 
                            being used in setTimeout, this is wrapped
            ", see evidence field for the suspicious comment/snippet.`
* URL: https://www.nighthawkpro.com/wp-login.php%3Freauth=1&redirect_to=https%253A%252F%252Fwww.nighthawkpro.com%252Fwp-admin%252F
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (reauth,redirect_to)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `//# sourceURL=user-profile-js-extra`
  * Other Info: `The following pattern was used: \bUSER\b and was detected in likely comment: "//# sourceURL=user-profile-js-extra", see evidence field for the suspicious comment/snippet.`
* URL: https://www.nighthawkpro.com/wp-login.php
  * Node Name: `https://www.nighthawkpro.com/wp-login.php ()(log,pwd,redirect_to,rememberme,testcookie,wp-submit)`
  * Method: `POST`
  * Parameter: ``
  * Attack: ``
  * Evidence: `//# sourceURL=user-profile-js-extra`
  * Other Info: `The following pattern was used: \bUSER\b and was detected in likely comment: "//# sourceURL=user-profile-js-extra", see evidence field for the suspicious comment/snippet.`


Instances: 4

### Solution

Remove all comments that return information that may help an attacker and fix any underlying problems they refer to.

### Reference



#### CWE Id: [ 615 ](https://cwe.mitre.org/data/definitions/615.html)


#### WASC Id: 13

#### Source ID: 3

### [ Modern Web Application ](https://www.zaproxy.org/docs/alerts/10109/)



##### Informational (Medium)

### Description

The application appears to be a modern web application. If you need to explore it automatically then the Ajax Spider may well be more effective than the standard one.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<a class="toggleMenu" href="#">Menu</a>`
  * Other Info: `Links have been found that do not have traditional href attributes, which is an indication that this is a modern web application.`
* URL: https://www.nighthawkpro.com/about-us/
  * Node Name: `https://www.nighthawkpro.com/about-us/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<a class="toggleMenu" href="#">Menu</a>`
  * Other Info: `Links have been found that do not have traditional href attributes, which is an indication that this is a modern web application.`
* URL: https://www.nighthawkpro.com/admin/login
  * Node Name: `https://www.nighthawkpro.com/admin/login`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script defer="defer" src="./static/js/main.2908db4a.js"></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`
* URL: https://www.nighthawkpro.com/contact/
  * Node Name: `https://www.nighthawkpro.com/contact/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<a class="toggleMenu" href="#">Menu</a>`
  * Other Info: `Links have been found that do not have traditional href attributes, which is an indication that this is a modern web application.`
* URL: https://www.nighthawkpro.com/demo/
  * Node Name: `https://www.nighthawkpro.com/demo/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script defer="defer" src="/demo/static/js/main.e2908079.js"></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`

Instances: Systemic


### Solution

This is an informational alert and so no changes are required.

### Reference




#### Source ID: 3

### [ Non-Storable Content ](https://www.zaproxy.org/docs/alerts/10049/)



##### Informational (Medium)

### Description

The response contents are not storable by caching components such as proxy servers. If the response does not contain sensitive, personal or user-specific information, it may benefit from being stored and cached, to improve performance.

* URL: https://www.nighthawkpro.com/api
  * Node Name: `https://www.nighthawkpro.com/api`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-admin/
  * Node Name: `https://www.nighthawkpro.com/wp-admin/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-admin/admin-ajax.php
  * Node Name: `https://www.nighthawkpro.com/wp-admin/admin-ajax.php`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``


Instances: 3

### Solution

The content may be marked as storable by ensuring that the following conditions are satisfied:
The request method must be understood by the cache and defined as being cacheable ("GET", "HEAD", and "POST" are currently defined as cacheable)
The response status code must be understood by the cache (one of the 1XX, 2XX, 3XX, 4XX, or 5XX response classes are generally understood)
The "no-store" cache directive must not appear in the request or response header fields
For caching by "shared" caches such as "proxy" caches, the "private" response directive must not appear in the response
For caching by "shared" caches such as "proxy" caches, the "Authorization" header field must not appear in the request, unless the response explicitly allows it (using one of the "must-revalidate", "public", or "s-maxage" Cache-Control response directives)
In addition to the conditions above, at least one of the following conditions must also be satisfied by the response:
It must contain an "Expires" header field
It must contain a "max-age" response directive
For "shared" caches such as "proxy" caches, it must contain a "s-maxage" response directive
It must contain a "Cache Control Extension" that allows it to be cached
It must have a status code that is defined as cacheable by default (200, 203, 204, 206, 300, 301, 404, 405, 410, 414, 501).

### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html ](https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html)


#### CWE Id: [ 524 ](https://cwe.mitre.org/data/definitions/524.html)


#### WASC Id: 13

#### Source ID: 3

### [ Re-examine Cache-control Directives ](https://www.zaproxy.org/docs/alerts/10015/)



##### Informational (Low)

### Description

The cache-control header has not been set properly or is missing, allowing the browser and proxies to cache content. For static assets like css, js, or image files this might be intended, however, the resources should be reviewed to ensure that no sensitive content will be cached.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/robots.txt
  * Node Name: `https://www.nighthawkpro.com/robots.txt`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-json/
  * Node Name: `https://www.nighthawkpro.com/wp-json/`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-sitemap-index.xsl
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap-index.xsl`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://www.nighthawkpro.com/wp-sitemap.xml
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap.xml`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``

Instances: Systemic


### Solution

For secure content, ensure the cache-control HTTP header is set with "no-cache, no-store, must-revalidate". If an asset should be cached consider setting the directives "public, max-age, immutable".

### Reference


* [ https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#web-content-caching ](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#web-content-caching)
* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
* [ https://grayduck.mn/2021/09/13/cache-control-recommendations/ ](https://grayduck.mn/2021/09/13/cache-control-recommendations/)


#### CWE Id: [ 525 ](https://cwe.mitre.org/data/definitions/525.html)


#### WASC Id: 13

#### Source ID: 3

### [ Session Management Response Identified ](https://www.zaproxy.org/docs/alerts/10112/)



##### Informational (Medium)

### Description

The given response has been identified as containing a session management token. The 'Other Info' field contains a set of header tokens that can be used in the Header Based Session Management Method. If the request is in a context which has a Session Management Method set to "Auto-Detect" then this rule will change the session management to use the tokens identified.

* URL: https://www.nighthawkpro.com/wp-login.php%3Faction=lostpassword
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (action)`
  * Method: `GET`
  * Parameter: `wordpress_test_cookie`
  * Attack: ``
  * Evidence: `wordpress_test_cookie`
  * Other Info: `cookie:wordpress_test_cookie`
* URL: https://www.nighthawkpro.com/wp-login.php%3Freauth=1&redirect_to=https%253A%252F%252Fwww.nighthawkpro.com%252Fwp-admin%252F
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (reauth,redirect_to)`
  * Method: `GET`
  * Parameter: `wordpress_test_cookie`
  * Attack: ``
  * Evidence: `wordpress_test_cookie`
  * Other Info: `cookie:wordpress_test_cookie`
* URL: https://www.nighthawkpro.com/wp-login.php
  * Node Name: `https://www.nighthawkpro.com/wp-login.php ()(log,pwd,redirect_to,rememberme,testcookie,wp-submit)`
  * Method: `POST`
  * Parameter: `wordpress_test_cookie`
  * Attack: ``
  * Evidence: `wordpress_test_cookie`
  * Other Info: `cookie:wordpress_test_cookie`


Instances: 3

### Solution

This is an informational alert rather than a vulnerability and so there is nothing to fix.

### Reference


* [ https://www.zaproxy.org/docs/desktop/addons/authentication-helper/session-mgmt-id/ ](https://www.zaproxy.org/docs/desktop/addons/authentication-helper/session-mgmt-id/)



#### Source ID: 3

### [ Storable and Cacheable Content ](https://www.zaproxy.org/docs/alerts/10049/)



##### Informational (Medium)

### Description

The response contents are storable by caching components such as proxy servers, and may be retrieved directly from the cache, rather than from the origin server by the caching servers, in response to similar requests from other users. If the response data is sensitive, personal or user-specific, this may result in sensitive information being leaked. In some cases, this may even result in a user gaining complete control of the session of another user, depending on the configuration of the caching components in use in their environment. This is primarily an issue where "shared" caching servers such as "proxy" caches are configured on the local network. This configuration is typically found in corporate or educational environments, for instance.

* URL: https://www.nighthawkpro.com/
  * Node Name: `https://www.nighthawkpro.com/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`
* URL: https://www.nighthawkpro.com/robots.txt
  * Node Name: `https://www.nighthawkpro.com/robots.txt`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`
* URL: https://www.nighthawkpro.com/sitemap.xml
  * Node Name: `https://www.nighthawkpro.com/sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`
* URL: https://www.nighthawkpro.com/wp-json/
  * Node Name: `https://www.nighthawkpro.com/wp-json/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`
* URL: https://www.nighthawkpro.com/wp-sitemap.xml
  * Node Name: `https://www.nighthawkpro.com/wp-sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`

Instances: Systemic


### Solution

Validate that the response does not contain sensitive, personal or user-specific information. If it does, consider the use of the following HTTP response headers, to limit, or prevent the content being stored and retrieved from the cache by another user:
Cache-Control: no-cache, no-store, must-revalidate, private
Pragma: no-cache
Expires: 0
This configuration directs both HTTP 1.0 and HTTP 1.1 compliant caching servers to not store the response, and to not retrieve the response (without validation) from the cache, in response to a similar request.

### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html ](https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html)


#### CWE Id: [ 524 ](https://cwe.mitre.org/data/definitions/524.html)


#### WASC Id: 13

#### Source ID: 3

### [ User Controllable HTML Element Attribute (Potential XSS) ](https://www.zaproxy.org/docs/alerts/10031/)



##### Informational (Low)

### Description

This check looks at user-supplied input in query string parameters and POST data to identify where certain HTML attribute values might be controlled. This provides hot-spot detection for XSS (cross-site scripting) that will require further review by a security analyst to determine exploitability.

* URL: https://www.nighthawkpro.com/wp-login.php%3Faction=lostpassword
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (action)`
  * Method: `GET`
  * Parameter: `action`
  * Attack: ``
  * Evidence: ``
  * Other Info: `User-controlled HTML attribute values were found. Try injecting special characters to see if XSS might be possible. The page at the following URL:

https://www.nighthawkpro.com/wp-login.php?action=lostpassword

appears to include user input in:
a(n) [form] tag [name] attribute

The user input found was:
action=lostpassword

The user-controlled value was:
lostpasswordform`
* URL: https://www.nighthawkpro.com/wp-login.php%3Freauth=1&redirect_to=https%253A%252F%252Fwww.nighthawkpro.com%252Fwp-admin%252F
  * Node Name: `https://www.nighthawkpro.com/wp-login.php (reauth,redirect_to)`
  * Method: `GET`
  * Parameter: `redirect_to`
  * Attack: ``
  * Evidence: ``
  * Other Info: `User-controlled HTML attribute values were found. Try injecting special characters to see if XSS might be possible. The page at the following URL:

https://www.nighthawkpro.com/wp-login.php?reauth=1&redirect_to=https%3A%2F%2Fwww.nighthawkpro.com%2Fwp-admin%2F

appears to include user input in:
a(n) [link] tag [href] attribute

The user input found was:
redirect_to=https://www.nighthawkpro.com/wp-admin/

The user-controlled value was:
https://www.nighthawkpro.com/wp-admin/css/forms.min.css?ver=6.9.3`
* URL: https://www.nighthawkpro.com/wp-login.php
  * Node Name: `https://www.nighthawkpro.com/wp-login.php ()(log,pwd,redirect_to,rememberme,testcookie,wp-submit)`
  * Method: `POST`
  * Parameter: `redirect_to`
  * Attack: ``
  * Evidence: ``
  * Other Info: `User-controlled HTML attribute values were found. Try injecting special characters to see if XSS might be possible. The page at the following URL:

https://www.nighthawkpro.com/wp-login.php

appears to include user input in:
a(n) [link] tag [href] attribute

The user input found was:
redirect_to=https://www.nighthawkpro.com/wp-admin/

The user-controlled value was:
https://www.nighthawkpro.com/wp-admin/css/forms.min.css?ver=6.9.3`
* URL: https://www.nighthawkpro.com/wp-login.php
  * Node Name: `https://www.nighthawkpro.com/wp-login.php ()(log,pwd,redirect_to,rememberme,testcookie,wp-submit)`
  * Method: `POST`
  * Parameter: `rememberme`
  * Attack: ``
  * Evidence: ``
  * Other Info: `User-controlled HTML attribute values were found. Try injecting special characters to see if XSS might be possible. The page at the following URL:

https://www.nighthawkpro.com/wp-login.php

appears to include user input in:
a(n) [input] tag [value] attribute

The user input found was:
rememberme=forever

The user-controlled value was:
forever`
* URL: https://www.nighthawkpro.com/wp-login.php
  * Node Name: `https://www.nighthawkpro.com/wp-login.php ()(log,pwd,redirect_to,rememberme,testcookie,wp-submit)`
  * Method: `POST`
  * Parameter: `wp-submit`
  * Attack: ``
  * Evidence: ``
  * Other Info: `User-controlled HTML attribute values were found. Try injecting special characters to see if XSS might be possible. The page at the following URL:

https://www.nighthawkpro.com/wp-login.php

appears to include user input in:
a(n) [input] tag [value] attribute

The user input found was:
wp-submit=Log In

The user-controlled value was:
log in`


Instances: 5

### Solution

Validate all input and sanitize output it before writing to any HTML attributes.

### Reference


* [ https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html ](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)


#### CWE Id: [ 20 ](https://cwe.mitre.org/data/definitions/20.html)


#### WASC Id: 20

#### Source ID: 3


