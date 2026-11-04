"""시험 서버의 PKCE와 bearer 판정이 잘못된 값을 거부하는지 확인한다."""
import base64
import hashlib
import json
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request

import oauth_server


class FixtureChecks(unittest.TestCase):
    def setUp(self):
        self.server = oauth_server.Server()
        self.worker = threading.Thread(target=self.server.serve_forever)
        self.worker.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()

    def test_wrong_pkce_verifier_is_rejected(self):
        self.server.redirect = "http://127.0.0.1:1234/callback"
        self.server.challenge = base64.urlsafe_b64encode(hashlib.sha256(b"right").digest()).rstrip(b"=").decode()
        body = urllib.parse.urlencode({"grant_type": "authorization_code", "client_id": "fixture-client", "redirect_uri": self.server.redirect, "code": "fixture-code", "code_verifier": "wrong"}).encode()
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.server.origin + "/token", body, timeout=5)
        self.assertEqual(error.exception.code, 400)
        self.assertFalse(self.server.issued)

    def test_wrong_bearer_is_rejected(self):
        self.server.issued = True
        request = urllib.request.Request(self.server.origin + "/socket", headers={"Authorization": "Bearer wrong"})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=5)
        self.assertEqual(error.exception.code, 401)
        self.assertEqual(self.server.opened, 0)


if __name__ == "__main__":
    unittest.main()
